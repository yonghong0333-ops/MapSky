// ------------------------------------------------------------------
// electron/scripts/adhoc-sign.js —— macOS 自簽（ad-hoc signing）
//
// electron-builder 的 afterPack hook（設定在 package.json 的 build.afterPack）。
//
// 為什麼需要：
//   沒有 Apple Developer 憑證時，build.mac.identity 設成 null，electron-builder
//   會「完全不簽」。但 Electron 的 .app 在打包過程中 Info.plist、app.asar 都被
//   改過，原本 Electron 官方附的簽章就失效了；再加上 universal 合併之後，整包
//   等於「簽章壞掉」。Apple Silicon（arm64）上這種 App 一旦帶著下載隔離標記
//   （quarantine）就會直接顯示「MapSky 已損毀，無法打開」，而且沒有「仍要打開」
//   的選項。
//
//   改成 ad-hoc 簽章（codesign --sign -，不需要憑證、不用錢）之後，整包 .app
//   有一份自洽有效的簽章，Gatekeeper 會退回一般「無法驗證開發者」的流程，使用者
//   可以到「系統設定 → 隱私權與安全性 → 仍要打開」放行。
//
// 這「不是」公證：ad-hoc 簽章不會讓 Gatekeeper 完全不擋，只是把「已損毀」
// 變成「可手動放行」。要完全不擋只有 Developer ID 簽章＋公證（US$99/年）。
//
// 執行時機：
//   universal 建置會先把 x64 / arm64 各自打包到 "*-temp" 資料夾，再用
//   @electron/universal 合併成最終的 .app，最後才呼叫一次 afterPack（這時
//   appOutDir 是最終資料夾）。這裡只簽最終那份，跳過 "*-temp"。
//
// 注意：不要加 --options runtime（Hardened Runtime）。ad-hoc 簽章沒有 Entitlements
// 可以宣告 allow-jit，開了 Electron（V8 JIT）會直接閃退。
// ------------------------------------------------------------------

const path = require("path");
const fs = require("fs");
const { execFileSync, spawnSync } = require("child_process");

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// Mach-O 檔頭魔術數字（含 universal/fat）。用來找出 app.asar.unpacked 裡的原生模組
// （例如 electron-liquid-glass 的 .node）——這類放在 Resources 底下的散裝執行檔，
// codesign --deep 不一定會逐一簽，先自己由內往外簽好，再簽整包。
const MACHO_MAGICS = new Set(["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca"]);

function findMachOFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findMachOFiles(full, out);
    } else if (entry.isFile()) {
      const fd = fs.openSync(full, "r");
      try {
        const buf = Buffer.alloc(4);
        if (fs.readSync(fd, buf, 0, 4, 0) === 4 && MACHO_MAGICS.has(buf.toString("hex"))) out.push(full);
      } finally {
        fs.closeSync(fd);
      }
    }
  }
  return out;
}

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  // universal 打包中間產物（x64-temp / arm64-temp）不簽，只簽最終合併完的。
  if (path.basename(context.appOutDir).endsWith("-temp")) return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  if (!fs.existsSync(appPath)) {
    throw new Error(`[adhoc-sign] 找不到 ${appPath}，無法簽章`);
  }

  // codesign 只有 macOS 有。在 Linux／Windows 上試打包 mac 版時直接略過，
  // 不要讓開發時的試跑失敗；正式發佈一律在 macos-latest runner 上跑。
  if (process.platform !== "darwin") {
    console.warn(`[adhoc-sign] 目前不是 macOS，跳過簽章（${appPath} 會是未簽章版本）`);
    return;
  }

  console.log(`[adhoc-sign] ad-hoc 簽章：${appPath}`);

  // 先簽 app.asar.unpacked 裡的原生模組（若有）。
  const unpackedDir = path.join(appPath, "Contents", "Resources", "app.asar.unpacked");
  if (fs.existsSync(unpackedDir)) {
    for (const file of findMachOFiles(unpackedDir)) {
      console.log(`[adhoc-sign] 原生模組：${path.relative(appPath, file)}`);
      run("codesign", ["--force", "--sign", "-", "--timestamp=none", file]);
    }
  }

  // --force：覆蓋掉打包過程中已失效的舊簽章
  // --deep ：連 Frameworks、Helper.app 一起由內往外簽
  // --sign -：ad-hoc（不需要任何憑證）
  // --timestamp=none：ad-hoc 沒有時間戳伺服器可用
  run("codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath]);

  // 驗證：失敗會丟例外，讓整個建置在發佈之前就中止，不會把壞掉的 dmg 發出去。
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);

  // codesign -dv 的資訊是印在 stderr，用 spawnSync 才拿得到。順便確認真的是 adhoc。
  const dv = spawnSync("codesign", ["-dv", appPath], { encoding: "utf8" });
  const dvText = `${dv.stdout || ""}${dv.stderr || ""}`;
  if (!/Signature=adhoc/.test(dvText)) {
    throw new Error(`[adhoc-sign] 簽章後檢查不是 adhoc 簽章：\n${dvText}`);
  }
  console.log(`[adhoc-sign] 簽章驗證通過\n${dvText}`);
};
