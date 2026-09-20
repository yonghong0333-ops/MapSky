// ------------------------------------------------------------------
// electron/main.js —— 桌面版主行程
//
// 這個桌面版本身不含任何後端邏輯（沒有天氣資料、OAuth、Redis 那些），
// 純粹是一個載入線上 MapSky（https://mapskyapp.vercel.app）的原生視窗殼。
// 所有 API 呼叫、OAuth 登入都還是打去 Vercel 上的正式站台，金鑰留在
// 伺服器端，桌面安裝檔裡不會包到任何機密資料。
//
// 之所以選這個做法而不是把 public/ 資料夾整包塞進安裝檔本地執行，是
// 因為看了 api/auth 的程式碼後發現：OAuth 供應商（Google/GitHub/…）的
// 「Authorized redirect URI」都是寫死指向 https://mapskyapp.vercel.app/api/auth/callback，
// 登入完成後 Provider 一定會把使用者導回這個正式網域、Set-Cookie 也是
// 掛在這個網域下。如果桌面版改成載入「本地打包的前端 + 只轉發 /api 的
// reverse proxy」，畫面雖然一開始是本地檔案，但登入完成那一刻使用者
// 會被導到 mapskyapp.vercel.app（因為 Provider 只認得這個網址），session
// cookie 也會掛在那個網域、不會回到本地殼上，等於登入完卡住或要重新
// 導覽一次，體驗會很怪。直接讓桌面殼從頭到尾都载入正式網域，就完全
// 沒有這個落差，登入流程跟網頁版一模一樣。
// ------------------------------------------------------------------

const { app, BrowserWindow, Menu, shell, session, screen, net, ipcMain, nativeTheme, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { autoUpdater } = require("electron-updater");

const APP_URL = "https://mapskyapp.vercel.app/";
const APP_ORIGIN = new URL(APP_URL).origin;

// ------------------------------------------------------------------
// 桌面版登入改走「系統瀏覽器 + 自訂網址協定」：
//   1. 使用者點登入時，不在 Electron 視窗裡開 Google/GitHub/…的頁面
//      （這種內嵌瀏覽器，Google 那幾家近年會直接判定「不安全」擋掉或降級，
//      詳見 createWindow 裡 will-navigate 那段），改用系統瀏覽器（Safari／
//      Chrome…）開，讓使用者在「真正的」瀏覽器裡完成整個登入流程。
//   2. 伺服器（callback.js）登入完成後，不是直接把 session cookie 設在系統
//      瀏覽器上（那樣桌面殼看不到），而是導去 mapsky://login-complete?xchg=
//      一組短效、只能用一次的交換碼。
//   3. 作業系統看到 mapsky:// 開頭的網址會呼叫（或喚醒）這支 App：
//      macOS 用 open-url 事件；Windows/Linux 是把網址塞進新程序的啟動參數，
//      這裡用單一實例鎖（requestSingleInstanceLock）擋掉「新開一個一樣的
//      視窗」，改成把網址轉給「原本那個」實例處理。
//   4. 收到交換碼後，拿去跟 /api/auth/login?xchg=... 換回真正的 session token
//      （沒有另外開一支 exchange.js——Vercel Hobby 方案一個部署最多 12 支
//      function，這個交換邏輯併進 login.js 裡用 query string 分流，見
//      api/auth/login.js 的 handleDesktopExchange），
//      直接寫進桌面殼自己的 cookie，不用使用者做任何事，登入就完成了。
const CUSTOM_PROTOCOL = "mapsky";

// 開發模式下用 `electron .` 直接跑，執行檔是 Electron 本體，要多帶執行參數
// 系統才知道「點 mapsky:// 連結」該重新呼叫的是「這個專案」；打包後的正式版
// （.exe/.app 本身就是它自己）不用這段，直接註冊即可。
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(CUSTOM_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(CUSTOM_PROTOCOL);
}

// 目前這個模組作用域下「主視窗」的參考，給 handleAuthCallbackUrl 用來換完
// token 之後知道要重新整理／喚醒哪一個視窗；createWindow() 裡會賦值。
let mainWindow = null;

// macOS 定位：Chromium 在 Mac 上預設不用系統的 CoreLocation，而是走 Google 的網路定位
// 服務——Electron 沒有 Google API 金鑰，所以 navigator.geolocation 一定失敗（也因此
// 「定位服務」清單裡的 MapSky 從來沒有用過定位）。開啟 MacCoreLocationBackend 讓它改用
// macOS 系統定位，才會真的向系統要權限、拿到真正的座標。必須在 app ready 之前設定。
if (process.platform === "darwin") {
  app.commandLine.appendSwitch("enable-features", "MacCoreLocationBackend");
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // 已經有一個實例在跑了，這個新開的直接結束，不要真的開出第二個視窗。
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const urlArg = argv.find((a) => a.startsWith(`${CUSTOM_PROTOCOL}://`));
    if (urlArg) handleAuthCallbackUrl(urlArg);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// macOS 走這個事件，不是命令列參數。
app.on("open-url", (event, urlStr) => {
  event.preventDefault();
  handleAuthCallbackUrl(urlStr);
});


// 視窗圖示：Windows 用 .ico，macOS 用 .icns（Linux 沒有專用格式，退回 .ico
// 也能顯示）。macOS 上 Dock 圖示實際吃的是 app bundle 裡 Info.plist 指定的
// build-icon.icns（package.json 的 build.mac.icon），這裡只影響視窗本身
// （例如 alt-tab／Mission Control 縮圖），但設對格式沒有壞處。
const APP_ICON_PATH = path.join(
  __dirname,
  process.platform === "darwin" ? "build-icon.icns" : "build-icon.ico"
);

// 自訂標題列的高度（隱藏系統原生框之後，這段空間由我們自己畫）。
const TITLEBAR_HEIGHT = 36;

// macOS「玻璃」外觀（跟 Apple 內建 App 一樣，側邊欄／標題列會透出桌面桌布的
// 毛玻璃）。做法是三件事一起：
//   1. 視窗加 vibrancy（系統的 NSVisualEffectView，毛玻璃本體由系統畫）。
//   2. 視窗背景改透明，網頁 html/body 也改透明（見 MAC_GLASS_CSS），不然網頁
//      自己的實色／照片底會把毛玻璃整片蓋住，什麼都透不出來。
//   3. 側邊欄、標題列改半透明，讓毛玻璃在這兩塊露出來。
// 只在 macOS 生效，Windows／Linux 不受影響。若在某台 Mac 上看起來怪怪的，
// 用環境變數 MAPSKY_NO_GLASS=1 啟動就能整個關掉退回原本外觀。
const USE_MAC_GLASS = process.platform === "darwin" && process.env.MAPSKY_NO_GLASS !== "1";
// 標題列的天氣顏色疊在毛玻璃上的濃度：越低越透明、越接近 Apple 原生質感，但白色
// 文字的對比會變差（尤其白天／下雪這種偏淺的底圖）；越高越像原本的實色標題列。
const MAC_GLASS_TINT_OPACITY = 0.7;

// macOS 26（Tahoe）以上可以用真正的 Liquid Glass（AppKit 的 NSGlassEffectView），
// 質感跟 Apple 內建 App 一樣；Electron 本身沒有這個選項，是靠 electron-liquid-glass
// 這個原生模組把玻璃視圖塞到視窗網頁內容的後面。以下任何一步失敗（不是 macOS 26+、
// 模組載入不了、addView 失敗）都會退回上面的傳統 vibrancy 毛玻璃，不會壞掉。
// 要強制只用傳統毛玻璃：MAPSKY_NO_LIQUID_GLASS=1。
const LIQUID_GLASS_CORNER_RADIUS = 0; // 視窗圓角若跟玻璃對不上，調這個
const LIQUID_GLASS_TINT = "#FFFFFF26"; // 白色 15% 淡色調，讓側邊欄深色文字比較好讀

function getMacMajorVersion() {
  try {
    const v = parseInt(String(process.getSystemVersion()).split(".")[0], 10);
    if (Number.isFinite(v) && v >= 11) return v;
  } catch (_) { /* 往下走備援 */ }
  // 備援：用 Darwin 版本推算（Darwin 20–24 = macOS 11–15，Darwin 25 起 = macOS 26 起）
  const d = parseInt(os.release(), 10);
  if (!Number.isFinite(d)) return 0;
  return d >= 25 ? d + 1 : d - 9;
}

let liquidGlass = null;
if (USE_MAC_GLASS && process.env.MAPSKY_NO_LIQUID_GLASS !== "1" && getMacMajorVersion() >= 26) {
  try {
    liquidGlass = require("electron-liquid-glass");
  } catch (err) {
    // 這個模組是 optionalDependencies、只在 macOS 才會裝，載入失敗就退回 vibrancy。
    console.error("[liquid-glass] 載入失敗，改用傳統毛玻璃：", err && err.message ? err.message : err);
  }
}
// 網站本身的 CSS 沒有為透明視窗設計過（body 有一張實色照片背景、側邊欄是實色），
// 所以由外殼在 macOS 上補一份覆蓋樣式，不用改網站本體，網頁版完全不受影響。
// 照片背景從 body 搬到 .main 並用 fixed 定位，視覺上跟原本鋪滿視窗時一致，
// 只是側邊欄那一塊不再有照片墊底，露出來的是系統毛玻璃。
const MAC_GLASS_CSS = `
  html, body { background: transparent !important; background-image: none !important; }
  .main {
    background: url("/backgrounds/app-bg.jpg") center / cover no-repeat fixed;
  }
  .sidebar {
    background: rgba(255, 255, 255, 0.22) !important;
    border-right: 1px solid rgba(0, 0, 0, 0.08) !important;
  }
`;

// 多久檢查一次網站是不是有新版本。
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 分鐘
// 提示條倒數幾秒後自動重新整理。
const UPDATE_TOAST_COUNTDOWN_SECONDS = 10;

// Electron 預設 UA 尾巴會帶「Electron/版本號」，某些服務（尤其 Google OAuth）
// 看到這種內嵌瀏覽器字樣會擋掉或降級成舊版頁面。統一換成一般桌面版 Chrome 的
// UA（版本號用這個 Electron 內建的實際 Chromium 版本），主視窗、登入視窗都套用。
//
// 這裡的作業系統字串一定要跟著「實際跑的平台」走，不能不管三七二十一都寫死
// Windows：Chromium 除了看得到的 UA 字串之外，還會另外自動帶一組
// Sec-CH-UA-Platform 這類 Client Hints 標頭，裡面老實反映真正的作業系統
// （在 Mac 上就是 "macOS"）。如果 UA 字串講的是 Windows、Client Hints 卻誠實
// 招認是 macOS，兩邊對不起來，等於自己舉手告訴 Google「這是一個偽裝過的
// 內嵌瀏覽器」，反而更容易被判定成「這個瀏覽器或應用程式可能有疑慮」而擋掉
// 登入。所以 Mac 版就老實用 Mac 的 UA、Windows 版用 Windows 的 UA。
const CHROME_UA_PLATFORM =
  process.platform === "darwin"
    ? "Macintosh; Intel Mac OS X 10_15_7"
    : process.platform === "linux"
    ? "X11; Linux x86_64"
    : "Windows NT 10.0; Win64; x64";
const CHROME_UA = `Mozilla/5.0 (${CHROME_UA_PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

// 用 HEAD 請求拿首頁的 ETag / Last-Modified 當「版本指紋」。網站的 index.html
// 本來就設了 Cache-Control: no-cache, must-revalidate，Vercel 對靜態檔案照慣例
// 會回 ETag，內容一變這個值就會跟著變，不用額外改後端、也不用整包抓下來比對。
function fetchVersionTag() {
  return new Promise((resolve) => {
    const request = net.request({ method: "HEAD", url: APP_URL });
    request.on("response", (response) => {
      const etag = response.headers["etag"];
      const lastModified = response.headers["last-modified"];
      const tag = etag || lastModified || null;
      resolve(Array.isArray(tag) ? tag[0] : tag);
    });
    request.on("error", () => resolve(null));
    request.end();
  });
}

// 在畫面右下角插一條「發現新版本」提示條：倒數 10 秒沒動作就自動重新整理，
// 也可以按「重新整理」馬上刷新，或按「稍後再說」先關掉（之後如果偵測到還是
// 舊版本，下一輪檢查會再提示一次）。純粹用注入的 JS/CSS 畫出來，不用改
// 網站本身的程式碼。
function showUpdateToast(win) {
  if (win.isDestroyed()) return;
  const script = `
    (function () {
      if (document.getElementById("__mapsky_update_toast__")) return;
      var seconds = ${UPDATE_TOAST_COUNTDOWN_SECONDS};

      var el = document.createElement("div");
      el.id = "__mapsky_update_toast__";
      el.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;" +
        "background:#111827;color:#fff;padding:14px 16px;border-radius:14px;" +
        "box-shadow:0 10px 30px rgba(0,0,0,.35);font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
        "display:flex;flex-direction:column;gap:10px;max-width:300px;";

      var msg = document.createElement("div");
      msg.innerHTML = "發現新版本，<b id='__mapsky_update_countdown__'>" + seconds + "</b> 秒後自動重新整理";
      el.appendChild(msg);

      var row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

      var reloadBtn = document.createElement("button");
      reloadBtn.textContent = "重新整理";
      reloadBtn.style.cssText = "background:#3b82f6;color:#fff;border:none;padding:6px 14px;" +
        "border-radius:8px;cursor:pointer;font-weight:600;font-size:13px;";

      var laterBtn = document.createElement("button");
      laterBtn.textContent = "稍後再說";
      laterBtn.style.cssText = "background:transparent;color:#cbd5e1;border:1px solid #475569;" +
        "padding:6px 14px;border-radius:8px;cursor:pointer;font-size:13px;";

      row.appendChild(laterBtn);
      row.appendChild(reloadBtn);
      el.appendChild(row);
      document.body.appendChild(el);

      var timer = setInterval(function () {
        seconds -= 1;
        var c = document.getElementById("__mapsky_update_countdown__");
        if (c) c.textContent = String(seconds);
        if (seconds <= 0) {
          clearInterval(timer);
          location.reload();
        }
      }, 1000);

      reloadBtn.onclick = function () {
        clearInterval(timer);
        location.reload();
      };
      laterBtn.onclick = function () {
        clearInterval(timer);
        el.remove();
      };
    })();
  `;
  win.webContents.executeJavaScript(script).catch(() => {});
}

// 判斷「這是不是安裝後第一次打開」：userData 資料夾（每個使用者、每台電腦
// 都不一樣，安裝程式不會去動它）裡寫一個標記檔，找不到就是第一次，寫完之後
// 之後每次開啟都找得到，不會再跳。跟自動更新完全是兩回事——這裡只在乎
// 「這台電腦、這個使用者，第一次打開」，跟目前裝的是哪個版本無關。
function isFirstRun() {
  try {
    const marker = path.join(app.getPath("userData"), ".mapsky-first-run-done");
    if (fs.existsSync(marker)) return false;
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, new Date().toISOString());
    return true;
  } catch {
    return false; // 寫入失敗（例如權限問題）就保守當作不是第一次，避免每次開都彈
  }
}

// 安裝完成後第一次打開跳一個「感謝安裝」的歡迎卡片，跟 showUpdateToast 同一套
// 注入手法，但畫面正中央、要手動按「開始使用」才會關掉（不像更新提示條那樣
// 會自動倒數消失，畢竟這個只出現一次，不急著讓它自己不見）。
function showWelcomeToast(win) {
  if (win.isDestroyed()) return;
  const logoDataUri = getLogoDataUri();
  const script = `
    (function () {
      if (document.getElementById("__mapsky_welcome__")) return;

      var overlay = document.createElement("div");
      overlay.id = "__mapsky_welcome__";
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;" +
        "background:rgba(11,18,32,.55);display:flex;align-items:center;justify-content:center;" +
        "font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";

      var card = document.createElement("div");
      card.style.cssText = "background:#111827;color:#fff;border-radius:18px;" +
        "padding:32px 28px 26px;max-width:320px;width:calc(100% - 40px);text-align:center;" +
        "box-shadow:0 20px 50px rgba(0,0,0,.45);";

      var logo = document.createElement("img");
      logo.src = ${JSON.stringify(logoDataUri)};
      logo.style.cssText = "width:56px;height:56px;border-radius:14px;margin-bottom:14px;";
      card.appendChild(logo);

      var title = document.createElement("div");
      title.textContent = "感謝你安裝 MapSky！";
      title.style.cssText = "font-size:17px;font-weight:700;margin-bottom:8px;";
      card.appendChild(title);

      var desc = document.createElement("div");
      desc.textContent = "歡迎使用 MapSky 天氣桌面版，之後有新版本會自動幫你更新，隨時打開就是最新內容。";
      desc.style.cssText = "font-size:13px;color:#cbd5e1;line-height:1.7;margin-bottom:20px;";
      card.appendChild(desc);

      var btn = document.createElement("button");
      btn.textContent = "開始使用";
      btn.style.cssText = "width:100%;padding:11px;border:none;border-radius:10px;" +
        "background:#3b82f6;color:#fff;font-weight:700;font-size:14px;cursor:pointer;";
      btn.onmouseenter = function () { btn.style.background = "#2563eb"; };
      btn.onmouseleave = function () { btn.style.background = "#3b82f6"; };
      btn.onclick = function () { overlay.remove(); };
      card.appendChild(btn);

      overlay.appendChild(card);
      document.body.appendChild(overlay);
    })();
  `;
  win.webContents.executeJavaScript(script).catch(() => {});
}


// 下載完成時跳出來的提示（跟上面那個「網站內容有新版本」是兩回事，分開處理：
// 網站內容用 reload 就好，.exe 本體要整個重開安裝）。倒數結束或按「立即重新
// 啟動安裝」都是呼叫 preload 橋接的 window.mapskyAppUpdate.installNow()，
// 實際的 autoUpdater.quitAndInstall() 在主行程做。
function showExeUpdateToast(win, version) {
  if (win.isDestroyed()) return;
  const script = `
    (function () {
      if (document.getElementById("__mapsky_exe_update_toast__")) return;
      var seconds = ${UPDATE_TOAST_COUNTDOWN_SECONDS};

      var el = document.createElement("div");
      el.id = "__mapsky_exe_update_toast__";
      el.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;" +
        "background:#111827;color:#fff;padding:14px 16px;border-radius:14px;" +
        "box-shadow:0 10px 30px rgba(0,0,0,.35);font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
        "display:flex;flex-direction:column;gap:10px;max-width:300px;";

      var msg = document.createElement("div");
      msg.innerHTML = "MapSky ${version ? "v" + version + " " : ""}已下載完成，<b id='__mapsky_exe_update_countdown__'>" + seconds + "</b> 秒後自動重新啟動安裝";
      el.appendChild(msg);

      var row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

      var installBtn = document.createElement("button");
      installBtn.textContent = "立即重新啟動安裝";
      installBtn.style.cssText = "background:#3b82f6;color:#fff;border:none;padding:6px 14px;" +
        "border-radius:8px;cursor:pointer;font-weight:600;font-size:13px;";

      var laterBtn = document.createElement("button");
      laterBtn.textContent = "稍後再說";
      laterBtn.style.cssText = "background:transparent;color:#cbd5e1;border:1px solid #475569;" +
        "padding:6px 14px;border-radius:8px;cursor:pointer;font-size:13px;";

      row.appendChild(laterBtn);
      row.appendChild(installBtn);
      el.appendChild(row);
      document.body.appendChild(el);

      function installNow() {
        if (window.mapskyAppUpdate && window.mapskyAppUpdate.installNow) {
          window.mapskyAppUpdate.installNow();
        }
      }

      var timer = setInterval(function () {
        seconds -= 1;
        var c = document.getElementById("__mapsky_exe_update_countdown__");
        if (c) c.textContent = String(seconds);
        if (seconds <= 0) {
          clearInterval(timer);
          installNow();
        }
      }, 1000);

      installBtn.onclick = function () {
        clearInterval(timer);
        installNow();
      };
      laterBtn.onclick = function () {
        clearInterval(timer);
        el.remove();
      };
    })();
  `;
  win.webContents.executeJavaScript(script).catch(() => {});
}

// 軟體本體（.exe）的自動更新：用 electron-builder 內建的 electron-updater，
// 更新來源是這個 GitHub repo 的 Releases（見 package.json 的 publish 設定）。
// 開發者要出新版本時，本機跑 `npm run publish:win`（需要有 repo 寫入權限的
// GH_TOKEN 環境變數），electron-builder 會把安裝檔跟 latest.yml 一起上傳到
// GitHub Releases；使用者端這裡背景定期檢查 Releases 有沒有比目前版本新的，
// 有的話自動background下載，下載完成再跳提示條問要不要現在重開安裝，不用
// 使用者自己跑去官網重新下載一次 exe。
const APP_UPDATE_CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 小時

// 更新頻道本機設定：存在 userData 資料夾一個小 JSON 檔裡，跟著這台電腦這個
// 安裝走（不是跟著帳號走）。這裡只負責「這台電腦目前設成哪個頻道」，真正
// 「這個帳號有沒有資格切到公開測試版/一般測試版」是網站那邊
// （/api/auth/session 的 updateChannelAccess）判斷的——設定頁只會把選項
// 顯示給有資格的帳號，這裡單純照收到的值執行，不重複做權限檢查。
//
// ⚠️ 這是體驗層面的頻道選擇，不是安全機制：GitHub Releases 如果是公開的，
// 理論上任何人都能改這個檔案自己切到 alpha 頻道去抓「一般測試版」的安裝檔，
// 只是網站不會把這個選項顯示給沒資格的帳號而已。
const UPDATE_CHANNEL_FILE = () => path.join(app.getPath("userData"), "update-channel.json");
// 對應 electron-updater 的 channel 字串：stable 頻道不用設 channel（用預設
// 的 latest），public-beta/internal-beta 對應到 build 時 electron-builder
// 依 prerelease 標籤自動產生的 beta / alpha 頻道檔名。
const CHANNEL_MAP = { stable: null, "public-beta": "beta", "internal-beta": "alpha" };

function readUpdateChannel() {
  try {
    const raw = fs.readFileSync(UPDATE_CHANNEL_FILE(), "utf8");
    const data = JSON.parse(raw);
    if (data && CHANNEL_MAP.hasOwnProperty(data.channel)) return data.channel;
  } catch (e) {
    // 檔案不存在或壞掉，當作預設值處理
  }
  return "stable";
}

function writeUpdateChannel(channel) {
  try {
    fs.writeFileSync(UPDATE_CHANNEL_FILE(), JSON.stringify({ channel }), "utf8");
  } catch (e) {
    console.error("[updateChannel] 寫入本機設定失敗", e);
  }
}

function applyUpdateChannel(channel) {
  const mapped = CHANNEL_MAP.hasOwnProperty(channel) ? CHANNEL_MAP[channel] : null;
  autoUpdater.allowPrerelease = mapped !== null;
  // electron-updater 沒設 channel 時用預設（正式版 latest.yml）；有設就去
  // 抓對應頻道的 yml（beta.yml / alpha.yml）。
  autoUpdater.channel = mapped || undefined;
}

function setupAutoUpdater(win) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // 我們自己用提示條問使用者，不要它自己默默裝
  applyUpdateChannel(readUpdateChannel());

  autoUpdater.on("update-available", (info) => {
    if (!win.isDestroyed()) win.webContents.send("mapsky:update-available", info);
  });
  autoUpdater.on("update-downloaded", (info) => {
    showExeUpdateToast(win, info && info.version);
    if (!win.isDestroyed()) win.webContents.send("mapsky:update-downloaded", info && info.version);
  });
  // 開發環境（沒打包、沒簽章、沒有正式 Release）檢查一定會失敗，這裡吞掉
  // 錯誤只印 log，不要讓一般使用者看到一串技術性錯誤訊息。
  autoUpdater.on("error", (err) => {
    console.error("[autoUpdater]", err == null ? "unknown error" : err.message || err);
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check(); // 開機先檢查一次
  const timer = setInterval(check, APP_UPDATE_CHECK_INTERVAL_MS);
  win.on("closed", () => clearInterval(timer));
}

// 讀一次 logo，轉成 base64 內嵌進注入的 HTML 裡——標題列是插進「別人網域」的
// 頁面裡，用 file:// 路徑當 <img src> 在 https 頁面裡會被當成混合內容擋掉，
// 用 data: URI 就沒有這個問題。
let cachedLogoDataUri = null;
function getLogoDataUri() {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  try {
    const buf = fs.readFileSync(path.join(__dirname, "icons", "app-logo.png"));
    cachedLogoDataUri = `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    cachedLogoDataUri = "";
  }
  return cachedLogoDataUri;
}

// 隱藏系統原生標題列之後（frame:false），自己畫一列會「跟著即時天氣變換底圖」
// 的自訂標題列：左邊 App 圖示＋名稱，接著地點＋天氣圖示／溫度／天氣狀況，
// 右邊網路狀態、搜尋／設定裝飾鈕、帳號頭像、縮小／放大還原／關閉。底圖依照
// 從頁面上抓到的天氣狀況（晴/多雲/雨/雷雨/雪…）＋當下時段（白天/黃昏/夜晚）
// 自動切換配色與插畫（太陽、月亮星空、雨滴、閃電、飄雪…）。因為桌面殼本身
// 不含任何天氣資料（見檔頭說明），這裡是用「掃描頁面上顯示出來的溫度／地點／
// 天氣文字」這種通用方式去偵測，不綁定網站實際的 DOM 結構，往後網站改版
// 大致上還是抓得到；抓不到時會退回一個中性的玻璃質感底色。
// 整段用注入的 HTML/CSS/JS 畫出來，不用改網站本身的程式碼；每次頁面（重新）
// 載入完都要重插一次，因為 reload 會把注入的東西一起洗掉。
function injectTitleBar(win) {
  if (win.isDestroyed()) return;
  const logoDataUri = getLogoDataUri();
  const script = `
    (function () {
      if (document.getElementById("__mapsky_titlebar__")) return;

      // Mac 用系統原生三顆燈（見 createWindow 的 titleBarStyle:"hidden" +
      // trafficLightPosition），這條自訂標題列上就不用再畫一組假的縮小／
      // 放大／關閉鈕；品牌名稱、天氣資訊、帳號那些內容改成整組靠右塞，
      // 留左邊那塊原生燈的位置空著。
      var IS_MAC = ${process.platform === "darwin" ? "true" : "false"};
      var IS_GLASS = ${USE_MAC_GLASS ? "true" : "false"};
      var GLASS_TINT_OPACITY = ${MAC_GLASS_TINT_OPACITY};

      // ---------- 共用 keyframes（雨滴/飄雪/閃爍星星/閃電/雲朵飄移）----------
      var styleTag = document.createElement("style");
      styleTag.id = "__mapsky_weather_keyframes__";
      styleTag.textContent =
        "@keyframes mapsky_rain_fall{0%{transform:translateY(-14px);opacity:0;}20%{opacity:.9;}100%{transform:translateY(34px);opacity:0;}}" +
        "@keyframes mapsky_snow_fall{0%{transform:translate(0,-10px);opacity:0;}12%{opacity:.95;}100%{transform:translate(8px,46px);opacity:0;}}" +
        "@keyframes mapsky_twinkle{0%,100%{opacity:.25;}50%{opacity:1;}}" +
        "@keyframes mapsky_lightning{0%,90%,100%{opacity:0;}92%{opacity:.9;}94%{opacity:.1;}96%{opacity:.8;}}" +
        "@keyframes mapsky_drift{0%{transform:translateX(0);}100%{transform:translateX(-14px);}}";
      document.head.appendChild(styleTag);

      var bar = document.createElement("div");
      bar.id = "__mapsky_titlebar__";
      // 不做圓角——視窗本身在 Windows 11 上已經是系統原生圓角，標題列自己再
      // 做一次圓角反而會在角落露出一小塊沒對齊的縫。background 交給下面
      // applyTheme() 依天氣動態設定，這裡先給一個過渡用的預設玻璃底色。
      bar.style.cssText = "position:fixed;top:0;left:0;right:0;height:${TITLEBAR_HEIGHT}px;" +
        "overflow:hidden;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.4);" +
        "z-index:2147483647;-webkit-app-region:drag;user-select:none;" +
        "font:13px 'Segoe UI Variable','Segoe UI',-apple-system,sans-serif;" +
        "border-bottom:1px solid rgba(255,255,255,.12);transition:background 1.2s ease;" +
        "background:linear-gradient(120deg,rgba(59,130,246,.55) 0%,rgba(99,102,241,.55) 100%);";

      // macOS 玻璃模式：標題列本身不畫實色底，改用一層半透明的天氣色疊在系統
      // 毛玻璃（視窗的 vibrancy）上面，桌面桌布才透得出來。
      var tint = null;
      if (IS_GLASS) {
        tint = document.createElement("div");
        tint.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:0;" +
          "opacity:" + GLASS_TINT_OPACITY + ";transition:background 1.2s ease;";
        // 左邊紅黃綠按鈕那一塊完全不上色，讓系統玻璃直接露出來（跟「系統設定」一樣，
        // 按鈕坐在玻璃上）；往右到放文字的地方才漸漸帶出天氣顏色，白字才看得清楚。
        var glassMask = "linear-gradient(90deg, transparent 0px, transparent 88px, #000 260px)";
        tint.style.webkitMaskImage = glassMask;
        tint.style.maskImage = glassMask;
        bar.appendChild(tint);
        bar.style.background = "transparent";
        bar.style.borderBottom = "none";
      }

      // 插畫層（太陽/月亮星空/雲/雨滴/雪花…），純裝飾、不接收滑鼠事件。
      var bgArt = document.createElement("div");
      bgArt.id = "__mapsky_bgart__";
      bgArt.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;opacity:.95;";
      bar.appendChild(bgArt);

      // 下面每一組插畫（太陽光暈/月亮星空/雲/雨滴/雪花/山脈…）原本的座標都是
      // 用「right:0px ~ right:170px」這種相對「畫布最右邊」的方式在畫，等於
      // 預設是畫在一塊寬 190px 的畫布上、貼齊畫布右緣。問題是如果直接把這塊
      // 畫布貼齊整條標題列的最右邊，就會剛好疊在網路狀態／搜尋／設定／頭像／
      // 縮放這排按鈕底下，等於整組動畫都被蓋住看不到。這裡另外包一層固定寬度
      // 190px、用 left:50%+transform 置中的容器，讓那塊畫布浮在標題列正中間，
      // 裡面每個插畫元素原本「right:N」的相對座標完全不用改。
      var bgArtInner = document.createElement("div");
      bgArtInner.id = "__mapsky_bgart_inner__";
      bgArtInner.style.cssText = "position:absolute;left:50%;top:0;bottom:0;width:190px;transform:translateX(-50%);";
      bgArt.appendChild(bgArtInner);

      // 一層由左到右淡出的深色遮罩，確保不管底圖亮或暗，白色文字跟按鈕都維持
      // 足夠對比度（雪景那種偏淺色的底圖尤其需要）。
      var scrim = document.createElement("div");
      scrim.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:0;" +
        "background:linear-gradient(90deg,rgba(0,0,0,.32) 0%,rgba(0,0,0,.12) 55%,rgba(0,0,0,0) 100%);";
      // 玻璃模式不要這層深色遮罩：它左邊最深，剛好蓋在紅黃綠按鈕後面，按鈕就會像
      // 放在深色板子上，不像玻璃。
      if (!IS_GLASS) bar.appendChild(scrim);

      var content = document.createElement("div");
      // 非 Mac：品牌／天氣放最左、網路狀態＋帳號＋縮放關閉鈕放最右，兩邊
      // 用 space-between 撐開。Mac：原生三顆燈已經佔掉左邊那塊位置，這裡
      // 全部內容改成一整組靠右塞（flex-end），左邊留白給原生燈。
      content.style.cssText = "position:relative;z-index:1;display:flex;align-items:center;" +
        "justify-content:" + (IS_MAC ? "flex-end" : "space-between") + ";width:100%;height:100%;" +
        "padding:" + (IS_MAC ? "0 14px" : "0 0 0 14px") + ";box-sizing:border-box;";
      bar.appendChild(content);

      var leftGroup = document.createElement("div");
      leftGroup.style.cssText = "display:flex;align-items:center;gap:16px;overflow:hidden;min-width:0;";
      content.appendChild(leftGroup);

      var brand = document.createElement("div");
      brand.style.cssText = "display:flex;align-items:center;gap:9px;flex-shrink:0;";
      brand.innerHTML = ${JSON.stringify('<img src="' + logoDataUri + '" style="width:18px;height:18px;border-radius:4px;display:block;" />')} +
        "<span style='white-space:nowrap;font-weight:600;font-size:12px;'>MapSky</span>";
      leftGroup.appendChild(brand);

      var PIN_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>';

      var weatherInfo = document.createElement("div");
      weatherInfo.id = "__mapsky_weather_info__";
      weatherInfo.style.cssText = "display:flex;align-items:center;gap:12px;white-space:nowrap;font-size:12px;flex-shrink:0;";
      weatherInfo.innerHTML =
        '<span style="display:flex;align-items:center;gap:4px;opacity:.95;">' + PIN_SVG + '<span id="__mapsky_wcity__">--</span></span>' +
        '<span style="width:1px;height:13px;background:rgba(255,255,255,.32);"></span>' +
        '<span style="display:flex;align-items:center;gap:6px;">' +
          '<span id="__mapsky_wicon__" style="display:flex;line-height:0;"></span>' +
          '<span id="__mapsky_wtemp__" style="font-weight:600;">--°C</span>' +
          '<span id="__mapsky_wcond__" style="opacity:.9;">--</span>' +
        '</span>';
      leftGroup.appendChild(weatherInfo);

      var rightGroup = document.createElement("div");
      rightGroup.style.cssText = "display:flex;align-items:stretch;height:100%;-webkit-app-region:no-drag;flex-shrink:0;";
      content.appendChild(rightGroup);

      function makeDivider() {
        var d = document.createElement("div");
        d.style.cssText = "width:1px;align-self:center;height:15px;background:rgba(255,255,255,.28);margin:0 3px;";
        return d;
      }

      // 網路狀態：依連線種類（Wi-Fi 用 Wi-Fi 圖示、有線用 4 格長條訊號圖示）
      // 決定圖示外觀；格數／顏色則是依「實際量到打到 MapSky 伺服器的延遲
      // (ping)」換算，不是單純看 navigator.onLine 那種只有連/不連兩態的
      // 判斷。滑鼠移上去用自己畫的小方框顯示目前的 ping 值（不是瀏覽器
      // 原生 title 那種延遲又醜的提示）。
      var wifiWrap = document.createElement("div");
      wifiWrap.style.cssText = "position:relative;display:flex;align-items:center;gap:5px;" +
        "padding:0 12px;font-size:11px;cursor:default;";

      var WIFI_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5a11 11 0 0 1 14 0"/><path d="M8.5 16a6 6 0 0 1 7 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/></svg>';

      // 4 格長條訊號圖示（有線網路用），level 是 0~4，填滿幾格用 color，
      // 其餘格子維持半透明白色底，跟手機訊號格那種畫法一樣。
      function buildBarsSvg(level, color) {
        var heights = [5, 8, 11, 14];
        var bars = "";
        for (var i = 0; i < 4; i++) {
          var h = heights[i];
          var x = 2 + i * 5;
          var y = 16 - h;
          var fill = i < level ? color : "rgba(255,255,255,.3)";
          bars += '<rect x="' + x + '" y="' + y + '" width="3" height="' + h + '" rx="1" fill="' + fill + '"></rect>';
        }
        return '<svg width="18" height="16" viewBox="0 0 20 16">' + bars + '</svg>';
      }

      // ping 換算格數／顏色的對照表：
      //   <=15ms  滿格＋（4 格，亮綠，體感最好那一檔）
      //   16-30ms 滿格（4 格，綠）
      //   31-60ms 3 格（黃）
      //   61-90ms 2 格（橙）
      //   >90ms   1 格（紅）
      //   離線／量不到 0 格（紅）
      function pingToLevel(ms) {
        if (ms == null) return { level: 0, color: "#f87171" };
        if (ms <= 15) return { level: 4, color: "#34d399" };
        if (ms <= 30) return { level: 4, color: "#22c55e" };
        if (ms <= 60) return { level: 3, color: "#eab308" };
        if (ms <= 90) return { level: 2, color: "#f97316" };
        return { level: 1, color: "#ef4444" };
      }

      // 連線種類：navigator.connection 在桌面版（尤其 Windows）常常測不出
      // 實際種類，type 多半是 "unknown"，這種情況預設當有線處理，量得到
      // 確切是 "wifi" 才切換成 Wi-Fi 圖示。
      var connKind = "wired";
      function refreshConnKind() {
        var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn && conn.type === "wifi") connKind = "wifi";
        else if (conn && conn.type && conn.type !== "unknown") connKind = "wired";
      }
      refreshConnKind();
      if (navigator.connection && navigator.connection.addEventListener) {
        navigator.connection.addEventListener("change", refreshConnKind);
      }

      var lastPingMs = null;

      function renderWifi() {
        var online = navigator.onLine;
        var info = online ? pingToLevel(lastPingMs) : { level: 0, color: "#f87171" };
        var icon = connKind === "wifi"
          ? '<span style="display:flex;color:' + info.color + ';">' + WIFI_SVG + '</span>'
          : buildBarsSvg(info.level, info.color);
        wifiWrap.innerHTML = icon + '<span>' + (online ? "已連線" : "離線") + '</span>' + pingTip.outerHTML;
        // innerHTML 整個換掉會把 pingTip 一起洗掉，換完要重新抓一次 DOM
        // 節點，不然後面 onmouseenter 抓到的會是舊的、已經離開文件的元素。
        pingTip = wifiWrap.lastElementChild;
      }

      // 自己畫的 hover 提示框（不是瀏覽器原生 title），滑上去顯示目前 ping 值。
      var pingTip = document.createElement("div");
      pingTip.style.cssText = "position:absolute;top:100%;left:50%;transform:translateX(-50%);" +
        "margin-top:6px;padding:4px 9px;border-radius:7px;background:#111827;color:#fff;" +
        "font-size:11px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .12s ease;" +
        "box-shadow:0 6px 16px rgba(0,0,0,.35);z-index:2147483647;";

      wifiWrap.onmouseenter = function () {
        pingTip.textContent = !navigator.onLine ? "離線" : (lastPingMs == null ? "量測中…" : ("Ping " + lastPingMs + " ms"));
        pingTip.style.opacity = "1";
      };
      wifiWrap.onmouseleave = function () { pingTip.style.opacity = "0"; };

      // 實際量測到 MapSky 伺服器的延遲：對站台根目錄打一個不快取的 HEAD
      // 請求，量從送出到收到回應的時間當作 ping。
      function measurePing() {
        if (!navigator.onLine) { lastPingMs = null; renderWifi(); return; }
        var start = performance.now();
        fetch(location.origin + "/?__ping=" + Date.now(), { method: "HEAD", cache: "no-store" })
          .then(function () {
            lastPingMs = Math.round(performance.now() - start);
            renderWifi();
          })
          .catch(function () {
            lastPingMs = null;
            renderWifi();
          });
      }

      renderWifi();
      measurePing();
      setInterval(measurePing, 5000);
      window.addEventListener("online", measurePing);
      window.addEventListener("offline", renderWifi);
      rightGroup.appendChild(wifiWrap);
      rightGroup.appendChild(makeDivider());

      // 搜尋——先做外觀，樣式跟視窗按鈕一致，之後要接功能時只要把
      // onclick 換掉即可，不用動版面。設定入口不另外做按鈕——點大頭貼本身
      // 就是進設定，不需要重複一顆齒輪圖示。
      var SEARCH_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

      function makeIconBtn(svg) {
        var b = document.createElement("button");
        b.innerHTML = svg;
        b.style.cssText = "width:38px;height:100%;padding:0;margin:0;box-sizing:border-box;border:none;" +
          "background:transparent;color:#fff;opacity:.9;cursor:default;display:flex;align-items:center;" +
          "justify-content:center;flex-shrink:0;transition:background .1s ease,opacity .1s ease;";
        b.onmouseenter = function () { b.style.background = "rgba(255,255,255,.16)"; b.style.opacity = "1"; };
        b.onmouseleave = function () { b.style.background = "transparent"; b.style.opacity = ".9"; };
        return b;
      }
      rightGroup.appendChild(makeIconBtn(SEARCH_SVG));

      // 帳號頭像——跟網頁版讀同一支 /api/auth/session，同一個瀏覽環境（同一份
      // cookie），登入狀態一定是同步的。有登入就顯示大頭貼，沒有就顯示預設
      // 灰色人形。
      var accountSlot = document.createElement("div");
      accountSlot.style.cssText = "display:flex;align-items:center;padding:0 10px;";
      rightGroup.appendChild(accountSlot);
      rightGroup.appendChild(makeDivider());

      var DEFAULT_AVATAR_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';

      function renderAvatar(session) {
        accountSlot.innerHTML = "";
        var wrap = document.createElement("div");
        wrap.style.cssText = "width:22px;height:22px;border-radius:50%;overflow:hidden;" +
          "background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;" +
          "flex-shrink:0;cursor:pointer;transition:background .1s ease,transform .1s ease;";
        var loggedIn = session && session.loggedIn;
        var profile = (loggedIn && session.profile) || {};
        var avatarSrc = profile.avatarDataUrl || profile.avatarUrl || "";
        var name = profile.nickname || profile.name || (loggedIn ? "已登入" : "未登入");
        wrap.title = name + "（點一下開啟帳號 / 設定）";
        wrap.innerHTML = avatarSrc
          ? '<img src="' + avatarSrc + '" style="width:100%;height:100%;object-fit:cover;" />'
          : DEFAULT_AVATAR_SVG;
        // 點大頭貼開「帳號/設定」：直接點分頁列那顆真正的 .tab-btn[data-tab="settings"]，
        // 換頁邏輯統一交給 renderer.js 處理，這裡不重複做設定面板。
        wrap.onmouseenter = function () { wrap.style.background = "rgba(255,255,255,.34)"; };
        wrap.onmouseleave = function () { wrap.style.background = "rgba(255,255,255,.2)"; };
        wrap.onmousedown = function () { wrap.style.transform = "scale(0.9)"; };
        wrap.onmouseup = function () { wrap.style.transform = "scale(1)"; };
        wrap.onclick = function () {
          var tabBtn = document.querySelector('.tab-btn[data-tab="settings"]');
          if (tabBtn) tabBtn.click();
        };
        accountSlot.appendChild(wrap);
      }

      renderAvatar(null);
      fetch("/api/auth/session").then(function (r) { return r.json(); })
        .then(renderAvatar)
        .catch(function () {});

      // Windows 11 內建 App（檔案總管、設定）用的原生圖示畫法跟顏色，
      // 這樣看起來才會像系統原生的視窗按鈕，不是另外畫的圖案。
      var ICONS = {
        minimize: '<svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" stroke-width="1"/></svg>',
        maximize: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
        restore: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="2" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/><path d="M2 2V0.5H9.5V8H8" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
        close: '<svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1"/></svg>'
      };

      // 標準 Windows 11 視窗按鈕比例：46px 寬、貼滿整個標題列高度，
      // 滑過去是白色半透明反白、關閉鈕滑過是 Windows 原生那個紅色 #c42b1c。
      function makeBtn(iconSvg, danger) {
        var b = document.createElement("button");
        b.innerHTML = iconSvg;
        b.style.cssText = "width:46px;height:100%;padding:0;margin:0;box-sizing:border-box;" +
          "border:none;border-radius:0;font-size:0;line-height:0;" +
          "background:transparent;color:#fff;cursor:pointer;" +
          "display:flex;align-items:center;justify-content:center;flex-shrink:0;" +
          "transition:background .1s ease;";
        b.onmouseenter = function () {
          b.style.background = danger ? "#c42b1c" : "rgba(255,255,255,.16)";
        };
        b.onmouseleave = function () {
          b.style.background = "transparent";
        };
        return b;
      }

      var maxBtn = null;
      if (!IS_MAC) {
        var minBtn = makeBtn(ICONS.minimize, false);
        maxBtn = makeBtn(ICONS.maximize, false);
        var closeBtn = makeBtn(ICONS.close, true);

        minBtn.onclick = function () { window.mapskyWindowControls.minimize(); };
        maxBtn.onclick = function () { window.mapskyWindowControls.maximize(); };
        closeBtn.onclick = function () { window.mapskyWindowControls.close(); };

        rightGroup.appendChild(minBtn);
        rightGroup.appendChild(maxBtn);
        rightGroup.appendChild(closeBtn);
      }

      document.documentElement.appendChild(bar);

      // 幫整份文件往下推，剛好空出標題列的高度，避免蓋到原本的畫面內容
      // （視窗本身在建立時已經多加了這段高度，所以不會因此多出捲軸）。
      var pushStyle = document.createElement("style");
      pushStyle.textContent = "html{margin-top:${TITLEBAR_HEIGHT}px !important;}";
      document.head.appendChild(pushStyle);

      if (maxBtn && window.mapskyWindowControls && window.mapskyWindowControls.onMaximizedChange) {
        window.mapskyWindowControls.onMaximizedChange(function (isMaximized) {
          maxBtn.innerHTML = isMaximized ? ICONS.restore : ICONS.maximize;
        });
      }

      // ================= 依即時天氣切換底圖 =================
      // 桌面殼本身沒有天氣資料（金鑰、API 都在 Vercel 那邊），所以用「掃描頁面
      // 上已經顯示出來的溫度／地點／天氣文字」這種通用方式偵測，不綁定網站
      // 實際的 class name／DOM 結構；找不到就退回中性玻璃底色，不會顯示錯誤
      // 或空白。

      var ICON_SUN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>';
      var ICON_MOON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 1 0 10.5 10.5Z"/></svg>';
      var ICON_CLOUD = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M7 18a4 4 0 1 1 .5-7.98A5.5 5.5 0 0 1 18 12.5 3.5 3.5 0 0 1 17.5 18H7Z"/></svg>';
      var ICON_RAIN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M7 15a4 4 0 1 1 .5-7.98A5.5 5.5 0 0 1 18 9.5 3.5 3.5 0 0 1 17.5 15H7Z" fill="currentColor" stroke="none"/><path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2"/></svg>';
      var ICON_THUNDER = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14a4 4 0 1 1 .5-7.98A5.5 5.5 0 0 1 18 8.5 3.5 3.5 0 0 1 17.5 14H7Z" fill="currentColor" stroke="none"/><path d="M13 14l-3 5h3l-2 4"/></svg>';
      var ICON_SNOW = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 2v20M4.9 6l14.2 12M19.1 6L4.9 18M2 12h20"/></svg>';

      var CLOUD_ART_LIGHT =
        '<div style="position:absolute;bottom:4px;right:16px;width:90px;height:24px;background:#fff;opacity:.75;border-radius:20px;filter:blur(.5px);animation:mapsky_drift 14s ease-in-out infinite alternate;"></div>' +
        '<div style="position:absolute;bottom:12px;right:82px;width:54px;height:16px;background:#fff;opacity:.55;border-radius:16px;filter:blur(.5px);animation:mapsky_drift 10s ease-in-out infinite alternate-reverse;"></div>';
      var CLOUD_ART_DARK =
        '<div style="position:absolute;bottom:4px;right:16px;width:96px;height:26px;background:#0f172a;opacity:.55;border-radius:20px;filter:blur(1px);animation:mapsky_drift 16s ease-in-out infinite alternate;"></div>' +
        '<div style="position:absolute;bottom:14px;right:86px;width:58px;height:16px;background:#0f172a;opacity:.4;border-radius:16px;filter:blur(1px);animation:mapsky_drift 11s ease-in-out infinite alternate-reverse;"></div>';

      function rainLines() {
        var out = "";
        var offs = [24, 46, 68, 90, 112];
        for (var i = 0; i < offs.length; i++) {
          out += '<div style="position:absolute;top:2px;right:' + offs[i] + 'px;width:2px;height:14px;' +
            'background:rgba(255,255,255,.55);border-radius:2px;animation:mapsky_rain_fall 1s linear infinite;' +
            'animation-delay:' + (i * 0.15) + 's;"></div>';
        }
        return out;
      }
      function snowDots() {
        var out = "";
        var offs = [18, 40, 62, 84, 106, 128];
        for (var i = 0; i < offs.length; i++) {
          out += '<div style="position:absolute;top:-4px;right:' + offs[i] + 'px;width:4px;height:4px;border-radius:50%;' +
            'background:#fff;opacity:.9;animation:mapsky_snow_fall ' + (3 + (i % 3)) + 's linear infinite;' +
            'animation-delay:' + (i * 0.4) + 's;"></div>';
        }
        return out;
      }
      function starDots() {
        var out = "";
        var pos = [[6, 130], [14, 96], [4, 60], [20, 150], [10, 24]];
        for (var i = 0; i < pos.length; i++) {
          out += '<div style="position:absolute;top:' + pos[i][0] + 'px;right:' + pos[i][1] + 'px;width:3px;height:3px;' +
            'border-radius:50%;background:#fff;animation:mapsky_twinkle ' + (2 + (i % 3)) + 's ease-in-out infinite;' +
            'animation-delay:' + (i * 0.3) + 's;"></div>';
        }
        return out;
      }
      var MOUNTAIN_ART = '<svg width="170" height="' + ${TITLEBAR_HEIGHT} + '" viewBox="0 0 170 36" style="position:absolute;bottom:0;right:0;" preserveAspectRatio="none">' +
        '<polygon points="0,36 30,10 55,26 85,4 120,24 150,12 170,22 170,36" fill="#ffffff" opacity=".55"/>' +
        '<polygon points="20,36 60,18 100,30 140,14 170,26 170,36" fill="#ffffff" opacity=".8"/>' +
        '</svg>';

      var THEMES = {
        clear_day: {
          bg: "linear-gradient(135deg,#2f80ed 0%,#56ccf2 100%)",
          icon: ICON_SUN, label: "晴",
          art: '<div style="position:absolute;top:-26px;right:56px;width:76px;height:76px;border-radius:50%;' +
            'background:radial-gradient(circle,#fff9c4 0%,rgba(255,249,196,.55) 45%,rgba(255,249,196,0) 72%);"></div>' + CLOUD_ART_LIGHT
        },
        sunset: {
          bg: "linear-gradient(120deg,#3a3d8f 0%,#ff7e5f 55%,#feb47b 100%)",
          icon: ICON_SUN, label: "夕陽",
          art: '<div style="position:absolute;bottom:-36px;right:74px;width:100px;height:100px;border-radius:50%;' +
            'background:radial-gradient(circle,#fff3c4 0%,rgba(255,150,80,.75) 45%,rgba(255,150,80,0) 75%);"></div>'
        },
        night_clear: {
          bg: "linear-gradient(135deg,#0f1c3f 0%,#1b2a4a 100%)",
          icon: ICON_MOON, label: "晴",
          art: starDots() + '<svg width="26" height="26" viewBox="0 0 24 24" fill="#f5f3e7" style="position:absolute;top:6px;right:40px;">' +
            '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 1 0 10.5 10.5Z"/></svg>'
        },
        cloudy_day: {
          bg: "linear-gradient(135deg,#5b7c99 0%,#8fa9bd 100%)",
          icon: ICON_CLOUD, label: "多雲", art: CLOUD_ART_LIGHT
        },
        cloudy_night: {
          bg: "linear-gradient(135deg,#232f42 0%,#3c4b60 100%)",
          icon: ICON_CLOUD, label: "多雲", art: CLOUD_ART_DARK
        },
        rain: {
          bg: "linear-gradient(160deg,#3a4a5c 0%,#57697c 100%)",
          icon: ICON_RAIN, label: "下雨", art: CLOUD_ART_DARK + rainLines()
        },
        thunder: {
          bg: "linear-gradient(160deg,#0d1520 0%,#1a2740 100%)",
          icon: ICON_THUNDER, label: "雷雨",
          art: CLOUD_ART_DARK +
            '<div style="position:absolute;inset:0;background:#fff;opacity:0;animation:mapsky_lightning 5s ease-in-out infinite;"></div>' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fde68a" style="position:absolute;top:8px;right:60px;">' +
            '<path d="M13 2 4 14h6l-2 8 9-12h-6l2-8Z"/></svg>'
        },
        snow: {
          bg: "linear-gradient(135deg,#a8c8e0 0%,#dbe9f4 100%)",
          icon: ICON_SNOW, label: "下雪", art: MOUNTAIN_ART + snowDots()
        },
        glass: {
          bg: "linear-gradient(120deg,rgba(59,130,246,.55) 0%,rgba(99,102,241,.55) 100%)",
          icon: ICON_CLOUD, label: "--", art: ""
        }
      };

      var CONDITION_GROUPS = [
        { key: "thunder", words: ["雷陣雨", "雷雨", "颱風", "暴雨"] },
        { key: "snow", words: ["大雪", "小雪", "雪"] },
        { key: "rain", words: ["大雨", "中雨", "小雨", "陣雨", "雨"] },
        { key: "fog", words: ["霧", "靄"] },
        { key: "cloudy", words: ["多雲", "陰"] },
        { key: "clear", words: ["晴"] }
      ];
      var CITY_LIST = [
        "台北市", "臺北市", "新北市", "桃園市", "台中市", "臺中市", "台南市", "臺南市",
        "高雄市", "基隆市", "新竹市", "嘉義市", "新竹縣", "苗栗縣", "彰化縣", "南投縣",
        "雲林縣", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣", "台東縣", "臺東縣", "澎湖縣",
        "金門縣", "連江縣", "台灣", "臺灣"
      ];

      function detectWeatherFromPage() {
        var result = { city: null, temp: null, condition: null, conditionLabel: null };
        try {
          // 優先直接讀網站主畫面「現在天氣」卡片的專用欄位（#currentTemp／#currentDesc／
          // 縣市下拉選單），不再用整塊文字去猜。舊做法會把鄰近的「降雨機率」也掃進去，
          // 「雨」字一命中就永遠判成下雨。
          var tempEl = document.getElementById("currentTemp");
          var descEl = document.getElementById("currentDesc");
          var citySel = document.getElementById("citySelect");
          var descText = descEl ? (descEl.textContent || "").trim() : "";
          if (descText && descText !== "—") {
            var tm = tempEl ? (tempEl.textContent || "").match(/(-?\\d{1,2})\\s?°C/) : null;
            if (tm) result.temp = tm[1];
            for (var gi = 0; gi < CONDITION_GROUPS.length && !result.condition; gi++) {
              var g = CONDITION_GROUPS[gi];
              for (var wi = 0; wi < g.words.length; wi++) {
                if (descText.indexOf(g.words[wi]) !== -1) {
                  result.condition = g.key;
                  result.conditionLabel = descText;
                  break;
                }
              }
            }
            if (!result.condition) result.conditionLabel = descText;
            var cv = citySel ? citySel.value : "";
            if (cv && CITY_LIST.indexOf(cv) !== -1) result.city = cv;
            return result;
          }
          var tempRegex = /(-?\\d{1,2})\\s?°C/;
          var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          var node;
          while ((node = walker.nextNode())) {
            var text = node.nodeValue;
            if (!text || !text.trim()) continue;
            var m = text.match(tempRegex);
            if (!m) continue;
            result.temp = m[1];
            var scopeText = "";
            var scope = node.parentElement;
            for (var hop = 0; hop < 4 && scope; hop++) {
              scopeText += " " + (scope.textContent || "");
              scope = scope.parentElement;
            }
            // 備援路徑也要排除「降雨機率」，避免單獨一個「雨」字誤判成下雨。
            scopeText = scopeText.replace(/降雨機率|降雨/g, "");
            for (var i = 0; i < CONDITION_GROUPS.length && !result.condition; i++) {
              var grp = CONDITION_GROUPS[i];
              for (var j = 0; j < grp.words.length; j++) {
                if (scopeText.indexOf(grp.words[j]) !== -1) {
                  result.condition = grp.key;
                  result.conditionLabel = grp.words[j];
                  break;
                }
              }
            }
            for (var c = 0; c < CITY_LIST.length; c++) {
              if (scopeText.indexOf(CITY_LIST[c]) !== -1) { result.city = CITY_LIST[c]; break; }
            }
            break;
          }
        } catch (e) {}
        return result;
      }

      function isNightNow() { var h = new Date().getHours(); return h < 6 || h >= 19; }
      function isDuskNow() { var h = new Date().getHours(); return h >= 17 && h < 19; }

      function pickThemeKey(d) {
        if (d.condition === "thunder") return "thunder";
        if (d.condition === "rain") return "rain";
        if (d.condition === "snow") return "snow";
        if (d.condition === "fog" || d.condition === "cloudy") return isNightNow() ? "cloudy_night" : "cloudy_day";
        if (d.condition === "clear") {
          if (isDuskNow()) return "sunset";
          if (isNightNow()) return "night_clear";
          return "clear_day";
        }
        return "glass";
      }

      var wcity = document.getElementById("__mapsky_wcity__");
      var wtemp = document.getElementById("__mapsky_wtemp__");
      var wcond = document.getElementById("__mapsky_wcond__");
      var wicon = document.getElementById("__mapsky_wicon__");

      // ---------------- 目前所在位置 ----------------
      // 原本地名只能靠「掃描頁面上顯示出來的文字」去猜，網站畫面還沒渲染出
      // 天氣卡片、或卡片上根本沒寫完整地名時，就只能顯示預設的 "MapSky" 三個
      // 字，不是真正的位置。這裡改用系統定位（main.js 那邊的
      // setPermissionRequestHandler 已經允許 geolocation 權限），拿到經緯度
      // 後用 OpenStreetMap 的 Nominatim 反查成實際地址（縣市＋行政區），比較
      // 準、也不用等網站畫面渲染完才抓得到。拿不到定位權限或查詢失敗時，
      // 就維持原本掃描頁面文字的結果當備援，不會整個空著。
      var realLocationLabel = null;

      // 地名和天氣都交給外殼（主行程）查，網頁只負責拿座標。拿不到系統定位就傳 null，
      // 外殼改用 IP 概略定位，所以登入畫面、沒給定位權限時標題列也不會是空的。
      var shellWeather = null;

      function lookupShell(coords) {
        if (!window.mapskyLocation || !window.mapskyLocation.lookup) return;
        window.mapskyLocation.lookup(coords).then(function (r) {
          if (!r) return;
          if (r.place) {
            realLocationLabel = r.place;
            if (wcity) {
              wcity.textContent = r.place;
              wcity.title = r.approx ? r.place + "（依網路位置概略判斷）" : r.place;
            }
          }
          if (r.temp !== null && r.temp !== undefined) shellWeather = r;
          scanAndApply();
        }).catch(function () {});
      }

      function detectRealLocation() {
        if (!navigator.geolocation) { lookupShell(null); return; }
        navigator.geolocation.getCurrentPosition(
          function (pos) { lookupShell({ lat: pos.coords.latitude, lon: pos.coords.longitude }); },
          function () { lookupShell(null); },
          { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 8000 }
        );
      }

      detectRealLocation();
      // 定位不太可能一分鐘內就變，10 分鐘重定位一次就夠，不用太頻繁。
      var locationPollTimer = setInterval(detectRealLocation, 10 * 60 * 1000);

      function applyTheme(key, detected) {
        var theme = THEMES[key];
        if (tint) tint.style.background = theme.bg;
        else bar.style.background = theme.bg;
        bgArtInner.innerHTML = theme.art;
        if (wicon) wicon.innerHTML = theme.icon;
        // 真正定位查到的地址優先；查不到之前，先用掃描頁面猜到的地名頂著。
        if (wcity) wcity.textContent = realLocationLabel || detected.city || "MapSky";
        if (wtemp) wtemp.textContent = (detected.temp !== null) ? (detected.temp + "°C") : "--°C";
        if (wcond) wcond.textContent = detected.conditionLabel || theme.label;
      }

      function scanAndApply() {
        var detected = detectWeatherFromPage();
        // 網頁上沒有天氣卡片（例如登入畫面）時，用外殼自己查到的天氣墊底。
        if (shellWeather && detected.condition === null && detected.temp === null) {
          detected = { city: detected.city, temp: shellWeather.temp, condition: shellWeather.condition, conditionLabel: shellWeather.label };
        }
        applyTheme(pickThemeKey(detected), detected);
      }

      scanAndApply();
      var weatherPollTimer = setInterval(scanAndApply, 10000);

      // 網站內容多半是非同步載入天氣資料，用 MutationObserver 在畫面一有變化
      // 時（做 debounce 避免過於頻繁）就重新掃一次，這樣不用整整等 10 秒。
      var mutationDebounce = null;
      var observer = new MutationObserver(function () {
        clearTimeout(mutationDebounce);
        mutationDebounce = setTimeout(scanAndApply, 700);
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    })();
  `;
  win.webContents.executeJavaScript(script).catch(() => {});
}

// 背景檢查有沒有新版本：抓到跟上次不一樣的 ETag/Last-Modified 就跳提示條
// （不管視窗當下在不在前景，反正只是畫面角落一條小提示，不會打斷操作）。
function watchForUpdates(win) {
  let lastTag = null;

  const check = async () => {
    if (win.isDestroyed()) return;
    const tag = await fetchVersionTag();
    if (!tag) return; // 拿不到指紋（例如網路暫時不通）就跳過這次，不誤判有更新
    if (lastTag && tag !== lastTag) {
      showUpdateToast(win);
    }
    lastTag = tag;
  };

  check(); // 開機先記一次基準值
  const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  win.on("closed", () => clearInterval(timer));
}

// 登入按鈕在網頁裡是普通的 <a href="/api/auth/login?provider=...">，不是
// window.open 開新分頁，所以預設會直接在主視窗裡導覽過去、繞去 Google/GitHub/
// …等登入頁。這裡攔下來改開系統瀏覽器（見下面 openLoginInSystemBrowser），
// 不要在 Electron 視窗裡顯示這些外部登入頁——Google 這幾年對「內嵌瀏覽器
// 做 OAuth」的偵測不只看 User-Agent，用假冒的 UA 也不保證能繞過去，唯一
// 真正可靠的做法就是讓使用者在他自己「真正的」系統瀏覽器裡完成登入。
function isLoginUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.origin === APP_ORIGIN && u.pathname === "/api/auth/login";
  } catch {
    return false;
  }
}

// 打開系統瀏覽器讓使用者登入，額外帶一個 desktop=1 標記給 /api/auth/login，
// 讓伺服器知道「這次登入完成後要導回桌面殼」，而不是網頁版預設的
// 「導回首頁、把 session cookie 設在目前這個瀏覽器上」（那樣 session 會停在
// 系統瀏覽器裡，桌面殼看不到）。真正的登入頁面（Google/GitHub/…）完全沒有
// 被改動，使用者看到的是貨真價實的瀏覽器分頁，不會有任何「不安全」的警告。
function openLoginInSystemBrowser(loginUrl) {
  try {
    const u = new URL(loginUrl);
    u.searchParams.set("desktop", "1");
    shell.openExternal(u.toString());
  } catch {
    shell.openExternal(loginUrl);
  }
}

// 用 Electron 內建的 net 模組（跟 fetchVersionTag 同一套），拿短效交換碼
// （mapsky://login-complete?xchg=... 帶過來的那個）去跟伺服器換回真正的
// session token；換到之後才知道要不要、以及要用哪個 token 寫進本機 cookie。
function fetchExchangeToken(xchg) {
  return new Promise((resolve) => {
    const request = net.request({
      method: "GET",
      url: `${APP_ORIGIN}/api/auth/login?xchg=${encodeURIComponent(xchg)}`,
    });
    let body = "";
    request.on("response", (response) => {
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    request.on("error", () => resolve(null));
    request.end();
  });
}

// 拿交換碼換到 session token 之後，直接寫進桌面殼自己（session.defaultSession）
// 的 cookie 裡——跟 api/auth/callback.js 網頁版流程最後 Set-Cookie 的
// nexora_session 是同一個名字、同一個值，網站前端的邏輯完全不用區分「這個
// session 是網頁版登入的還是桌面版換回來的」，寫法一致。
async function finishDesktopLogin(xchg) {
  const data = await fetchExchangeToken(xchg);
  if (!data || !data.token) {
    console.error("桌面版登入交換失敗：", data && data.error);
    return;
  }
  try {
    await session.defaultSession.cookies.set({
      url: APP_ORIGIN,
      name: "nexora_session",
      value: data.token,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
    });
  } catch (e) {
    console.error("寫入 session cookie 失敗：", e);
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.reload();
  }
}

// 解析系統瀏覽器導回來的 mapsky://login-complete?xchg=... 網址，拿到交換碼
// 就去換 session；網址格式不對、或沒帶 xchg 就安靜地忽略（例如使用者手動
// 亂打一個 mapsky:// 開頭的網址）。
function handleAuthCallbackUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return;
  }
  if (parsed.protocol !== `${CUSTOM_PROTOCOL}:`) return;
  const xchg = parsed.searchParams.get("xchg");
  if (!xchg) return;
  finishDesktopLogin(xchg);
}

// macOS 玻璃模式的覆蓋樣式（見 MAC_GLASS_CSS 說明）。頁面每次（重新）載入
// 都要重插一次，跟標題列一樣。
function injectMacGlassCSS(win) {
  if (!USE_MAC_GLASS || win.isDestroyed()) return;
  win.webContents.insertCSS(MAC_GLASS_CSS).catch(() => {});
}

// 把 Liquid Glass 玻璃視圖塞進視窗（放在網頁內容後面，網頁透明的地方就是玻璃）。
// 失敗（addView 丟例外或回傳 -1，例如原生模組沒載入成功）就改用傳統 vibrancy。
function applyLiquidGlass(win) {
  if (!liquidGlass || win.isDestroyed()) return;
  let id = -1;
  try {
    win.setWindowButtonVisibility(true); // 套用玻璃後要重新確保原生三顆燈還在
    id = liquidGlass.addView(win.getNativeWindowHandle(), {
      cornerRadius: LIQUID_GLASS_CORNER_RADIUS,
      tintColor: LIQUID_GLASS_TINT,
    });
  } catch (err) {
    console.error("[liquid-glass] addView 失敗：", err && err.message ? err.message : err);
  }
  if (id < 0) {
    console.error("[liquid-glass] 沒有成功套用，退回傳統毛玻璃");
    try {
      win.setVibrancy("sidebar");
    } catch (_) { /* 舊系統或視窗已關閉，忽略 */ }
  }
}

// ---------------- 外殼自己查「所在地＋目前天氣」 ----------------
// 標題列原本只能讀網頁畫面上的天氣卡片；登入畫面沒有卡片，就只剩空的「--°C --」。
// 這裡在外殼（主行程）自己查：座標 → 地名（OpenStreetMap Nominatim）＋目前天氣
// （Open-Meteo，免金鑰）。放在主行程做，不受網頁的 CSP／CORS 限制，登入前也能用。
// 座標來源：網頁端先試系統定位；失敗就傳 null，這裡改用 IP 概略定位（只準到縣市）。
// 網頁上有真正的天氣卡片（登入後、中央氣象署資料）時，標題列仍以卡片為準，這裡只是墊底。
const LOCAL_WEATHER_TTL_MS = 5 * 60 * 1000;
const IP_LOCATION_TTL_MS = 30 * 60 * 1000;
let localWeatherCache = { key: null, at: 0, data: null };
let ipLocationCache = { at: 0, lat: null, lon: null };

function wmoToCondition(code) {
  if (code === 0) return { condition: "clear", label: "晴" };
  if (code === 1) return { condition: "clear", label: "晴朗" };
  if (code === 2) return { condition: "cloudy", label: "局部多雲" };
  if (code === 3) return { condition: "cloudy", label: "陰天" };
  if (code === 45 || code === 48) return { condition: "fog", label: "霧" };
  if (code >= 51 && code <= 57) return { condition: "rain", label: "毛毛雨" };
  if (code >= 61 && code <= 67) return { condition: "rain", label: "下雨" };
  if (code >= 71 && code <= 77) return { condition: "snow", label: "下雪" };
  if (code >= 80 && code <= 82) return { condition: "rain", label: "陣雨" };
  if (code === 85 || code === 86) return { condition: "snow", label: "陣雪" };
  if (code >= 95 && code <= 99) return { condition: "thunder", label: "雷雨" };
  return { condition: null, label: null };
}

async function fetchJsonWithTimeout(url, headers) {
  const res = await net.fetch(url, {
    headers: Object.assign({ Accept: "application/json" }, headers || {}),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function getIpCoords() {
  const now = Date.now();
  if (ipLocationCache.lat !== null && now - ipLocationCache.at < IP_LOCATION_TTL_MS) {
    return { lat: ipLocationCache.lat, lon: ipLocationCache.lon };
  }
  const ip = await fetchJsonWithTimeout("https://ipwho.is/");
  const lat = Number(ip && ip.latitude);
  const lon = Number(ip && ip.longitude);
  if (!ip || ip.success === false || !isFinite(lat) || !isFinite(lon)) throw new Error("ip lookup failed");
  ipLocationCache = { at: now, lat, lon };
  return { lat, lon };
}

async function lookupLocalWeather(input) {
  let lat, lon, approx = false;
  if (input && isFinite(Number(input.lat)) && isFinite(Number(input.lon))) {
    lat = Number(input.lat);
    lon = Number(input.lon);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error("bad coords");
  } else {
    const c = await getIpCoords();
    lat = c.lat;
    lon = c.lon;
    approx = true;
  }

  const key = lat.toFixed(2) + "," + lon.toFixed(2);
  const now = Date.now();
  if (localWeatherCache.key === key && now - localWeatherCache.at < LOCAL_WEATHER_TTL_MS) {
    return Object.assign({}, localWeatherCache.data, { approx });
  }

  const wxUrl =
    "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon +
    "&current=temperature_2m,weather_code&timezone=auto";
  const geoUrl =
    "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=" + lat + "&lon=" + lon +
    "&accept-language=zh-TW&zoom=12";
  const [wx, geo] = await Promise.allSettled([
    fetchJsonWithTimeout(wxUrl),
    // Nominatim 使用規範要求帶可辨識的 User-Agent
    fetchJsonWithTimeout(geoUrl, { "User-Agent": "MapSky-Desktop (https://github.com/yonghong0333-ops/MapSky)" }),
  ]);

  const data = { place: null, temp: null, condition: null, label: null };
  if (geo.status === "fulfilled" && geo.value) {
    const a = geo.value.address || {};
    const city = a.city || a.county || a.state || "";
    const district = a.town || a.city_district || a.district || a.suburb || "";
    const parts = [city, district].filter((v, i, arr) => v && arr.indexOf(v) === i);
    if (parts.length) data.place = parts.join(" ");
  }
  if (wx.status === "fulfilled" && wx.value && wx.value.current) {
    const cur = wx.value.current;
    if (typeof cur.temperature_2m === "number") data.temp = Math.round(cur.temperature_2m);
    const c = wmoToCondition(cur.weather_code);
    data.condition = c.condition;
    data.label = c.label;
  }
  if (data.place === null && data.temp === null) throw new Error("no data");

  localWeatherCache = { key, at: now, data };
  return Object.assign({}, data, { approx });
}

// ---------------- macOS 定位服務 ----------------
// Electron 沒有「主動向系統要定位權限」的 API：系統的授權視窗只會在 App 第一次真的
// 去讀定位時（navigator.geolocation）才跳出來，而且 App 得有正確簽章才會出現在
// 「定位服務」清單。所以這裡做兩件事：
//   1. 網頁定位失敗時（被拒絕／系統沒開／逾時），跳出說明並一鍵開啟系統設定。
//   2. 選單「檔案 → 定位服務設定…」隨時可以手動開。
// 定位失敗時網站本身會退回 IP 定位（只準到縣市），所以不會整個不能用。
const LOCATION_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices";
let locationHelpShown = false;

function openLocationSettings() {
  shell.openExternal(LOCATION_SETTINGS_URL).catch(() => {});
}

async function showLocationHelp(win) {
  if (process.platform !== "darwin" || locationHelpShown) return;
  locationHelpShown = true; // 每次開啟 App 只提醒一次，避免一直被打擾
  const opts = {
    type: "info",
    buttons: ["開啟定位服務設定", "稍後再說"],
    defaultId: 0,
    cancelId: 1,
    message: "MapSky 無法取得系統定位",
    detail:
      "請到「系統設定 → 隱私權與安全性 → 定位服務」，確認最上方的「定位服務」已開啟，" +
      "並把清單裡的 MapSky 打開。\n\n" +
      "如果清單裡找不到 MapSky，請完全結束 MapSky 後重新開啟，再按一次「自動定位目前位置」。\n\n" +
      "在那之前，MapSky 會改用網路 IP 概略定位（只能判斷到縣市）。",
  };
  try {
    const r = win && !win.isDestroyed() ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (r.response === 0) openLocationSettings();
  } catch (_) { /* 視窗已關閉，忽略 */ }
}

// 在網頁裡包一層 getCurrentPosition：把等待上限縮到 6 秒（原本 15 秒，使用者會以為
// 沒反應），失敗時通知外殼跳出說明。網站原本的失敗處理（退回 IP 定位）照常執行。
function injectGeolocationHelper(win) {
  if (process.platform !== "darwin" || win.isDestroyed()) return;
  const script = `
    (function () {
      if (window.__mapskyGeoWrapped || !navigator.geolocation || !window.mapskyLocation) return;
      window.__mapskyGeoWrapped = true;
      var geo = navigator.geolocation;
      var orig = geo.getCurrentPosition.bind(geo);
      var reported = false;
      geo.getCurrentPosition = function (ok, fail, opts) {
        var o = Object.assign({}, opts || {});
        if (!o.timeout || o.timeout > 6000) o.timeout = 6000;
        return orig(ok, function (err) {
          if (err && !reported) {
            reported = true;
            try { window.mapskyLocation.reportFailure(err.code); } catch (e) {}
          }
          if (fail) fail(err);
        }, o);
      };
    })();
  `;
  win.webContents.executeJavaScript(script).catch(() => {});
}

// macOS 上方選單列（MapSky／檔案／編輯…）。Electron 預設選單是英文，這裡整份換成
// 繁體中文，用詞照 Apple 在繁體中文 macOS 上的慣例（拷貝、顯示方式、輔助說明…）。
// 每個項目都用 role 保留系統行為（快捷鍵、複製貼上、結束、全螢幕等），label 只是
// 換顯示文字。只在 macOS 套用：Windows／Linux 是無框視窗，看不到選單列，維持原樣。
function setupMacMenu() {
  if (process.platform !== "darwin") return;
  const name = app.name || "MapSky";
  const template = [
    {
      label: name,
      submenu: [
        { role: "about", label: `關於 ${name}` },
        { type: "separator" },
        { role: "services", label: "服務" },
        { type: "separator" },
        { role: "hide", label: `隱藏 ${name}` },
        { role: "hideOthers", label: "隱藏其他" },
        { role: "unhide", label: "全部顯示" },
        { type: "separator" },
        { role: "quit", label: `結束 ${name}` },
      ],
    },
    {
      label: "檔案",
      submenu: [
        { label: "定位服務設定…", click: () => openLocationSettings() },
        { type: "separator" },
        { role: "close", label: "關閉視窗" },
      ],
    },
    {
      label: "編輯",
      submenu: [
        { role: "undo", label: "還原" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪下" },
        { role: "copy", label: "拷貝" },
        { role: "paste", label: "貼上" },
        { role: "pasteAndMatchStyle", label: "貼上並符合樣式" },
        { role: "delete", label: "刪除" },
        { role: "selectAll", label: "全選" },
      ],
    },
    {
      label: "顯示方式",
      submenu: [
        { role: "reload", label: "重新載入" },
        { role: "forceReload", label: "強制重新載入" },
        { role: "toggleDevTools", label: "開發人員工具" },
        { type: "separator" },
        { role: "resetZoom", label: "實際大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "縮小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "切換全螢幕" },
      ],
    },
    {
      label: "視窗",
      role: "window",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "zoom", label: "縮放" },
        { type: "separator" },
        { role: "front", label: "前置全部視窗" },
      ],
    },
    {
      label: "輔助說明",
      role: "help",
      submenu: [{ label: `${name} 網站`, click: () => shell.openExternal(APP_URL) }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  // 依照使用者螢幕解析度算一個合理的視窗大小（小筆電開小一點、大螢幕開大一點），
  // 而不是寫死固定尺寸。
  //   下限 960x640 —— 寬度一定要超過網站判斷「桌面版」的 901px 門檻（見下面），
  //   不然會誤跳手機版「加入主畫面」提示。
  //   上限 1600x1000 —— App 內容本身是偏窄的單欄卡片式版面，視窗開太大兩側只會
  //   留一堆空白，沒有意義。
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = Math.min(Math.max(Math.round(screenWidth * 0.65), 960), 1600);
  const winHeight = Math.min(Math.max(Math.round(screenHeight * 0.85), 640), 1000);

  // 網站沒有深色模式，側邊欄文字是為淺色底設計的。強制淺色外觀，避免使用者的
  // Mac 開深色模式時，毛玻璃變成深色、深色文字整片看不見。
  if (USE_MAC_GLASS) nativeTheme.themeSource = "light";

  const win = new BrowserWindow({
    // MapSky 網頁版自己會用 `matchMedia("(min-width: 901px)")` 判斷是不是「桌面」，
    // 沒過門檻就會當成手機瀏覽器，跳出「請用 Safari 開啟／加入主畫面」的提示
    // （這個提示只對手機有意義，桌面版不該看到）。所以這裡預設尺寸、最小尺寸都
    // 抓在 901px 以上，讓網站自己的判斷邏輯正確辨識成桌面，不用另外改網站程式碼。
    width: winWidth,
    height: winHeight + TITLEBAR_HEIGHT,
    minWidth: 960,
    minHeight: 640 + TITLEBAR_HEIGHT,
    title: "MapSky",
    icon: APP_ICON_PATH,
    backgroundColor: "#0b1220",
    // Mac 版：保留系統原生的紅黃綠三顆燈（縮小／放大／關閉），只隱藏原生
    // 標題文字列，位置照 Apple 預設留白（trafficLightPosition）算，不要自己
    // 畫假的三顆燈——長得再像终究不是原生控制項，行為（例如按住綠燈選單、
    // 深色模式配色）也對不起來。Windows／Linux 維持原本 frame:false，繼續用
    // 注入的自訂標題列（見 injectTitleBar）。
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hidden", trafficLightPosition: { x: 12, y: 11 } }
      : { frame: false }),
    // macOS 玻璃：vibrancy 是系統毛玻璃；要讓它透出來，視窗跟網頁背景都得是透明的
    // （官方文件：backgroundColor 的 alpha 只有在 transparent: true 時才有效）。
    // visualEffectState 用預設的 followWindow，視窗失焦時跟 Apple 內建 App 一樣
    // 會退成灰色。
    // Liquid Glass 模式：玻璃視圖是載入完成後由 addView 塞進去的，而且不能同時設
    // vibrancy（會蓋掉 Liquid Glass、變得模糊），所以這裡只給透明視窗。
    ...(USE_MAC_GLASS && liquidGlass
      ? { transparent: true, backgroundColor: "#00000000" }
      : USE_MAC_GLASS
        ? {
            vibrancy: "sidebar",
            visualEffectState: "followWindow",
            transparent: true,
            backgroundColor: "#00000000",
          }
        : {}),
    // Windows 11 原生的 Mica 毛玻璃效果——讓標題列（跟整個視窗背景）透出桌面
    // 底色，是目前公認最「現代 Windows」的視窗質感，不是自己用 CSS 半透明去
    // 模擬的假毛玻璃。只有 Windows 11 22H2 以上才會真的生效，舊版 Windows
    // Electron 會自動忽略這個設定、退回一般實色背景，不會壞掉。
    ...(process.platform === "win32" ? { backgroundMaterial: "mica" } : {}),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.webContents.setUserAgent(CHROME_UA);

  // 每次開軟體都保證是打網路拿最新內容，不要讓本地磁碟快取搶答
  // （index.html 本來就設了 no-cache/must-revalidate，這裡是保險再做一次）。
  win.webContents.session.clearCache().finally(() => {
    win.loadURL(APP_URL);
  });
  win.once("ready-to-show", () => win.show());

  // 自訂標題列的 DOM 是注入進去的，每次頁面（重新）載入完都要重插一次，
  // 不然 reload/導覽一次就被洗掉了。
  win.webContents.on("dom-ready", () => injectGeolocationHelper(win));
  win.webContents.on("did-finish-load", () => {
    injectTitleBar(win);
    injectMacGlassCSS(win);
  });
  // Liquid Glass 只要套一次（原生視圖會一直留在視窗上，重新整理網頁不會掉）。
  if (USE_MAC_GLASS && liquidGlass) {
    win.webContents.once("did-finish-load", () => applyLiquidGlass(win));
  }

  // 安裝後第一次打開才跳「感謝安裝」歡迎卡片，只跳這一次，跟標題列分開注入
  // （標題列每次載入都要重插，這個只在真正第一次打開時插一次就好）。
  if (isFirstRun()) {
    win.webContents.once("did-finish-load", () => showWelcomeToast(win));
  }

  // 把視窗「有沒有最大化」的狀態轉發給頁面，讓標題列的放大/還原鈕圖示能對上。
  win.on("maximize", () => win.webContents.send("mapsky:maximized-changed", true));
  win.on("unmaximize", () => win.webContents.send("mapsky:maximized-changed", false));

  // App 開著的時候背景檢查有沒有新版本，有的話跳出倒數提示條，
  // 不用整個重開軟體才吃得到最新版本。
  watchForUpdates(win);
  // 軟體本體（.exe）的自動更新——跟上面那個是兩回事，見 setupAutoUpdater 說明。
  setupAutoUpdater(win);

  // 點「使用 OO 登入」時，不要讓主視窗整個導覽去 Google/GitHub 這些登入頁，
  // 也不要在 Electron 視窗裡開（見 openLoginInSystemBrowser 說明），改開
  // 系統瀏覽器去跑。
  win.webContents.on("will-navigate", (event, url) => {
    if (isLoginUrl(url)) {
      event.preventDefault();
      openLoginInSystemBrowser(url);
    }
  });

  // 頁面裡任何「開新分頁」的連結（例如分享、外部說明連結）都改用系統瀏覽器開，
  // 不要在 App 裡再開一個 Electron 視窗。
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow = win;
  return win;
}

app.whenReady().then(() => {
  // 開發模式（`npm start`）在 macOS 上跑的是 Electron 本體的圖示，不是打包後
  // app bundle 裡的 icon；手動設一次 Dock 圖示純粹是開發時好看，正式打包
  // （electron-builder）出來的 .app 本身就會用 build.mac.icon，不受影響。
  // 注意：nativeImage 不支援解析 .icns，只能吃 png/jpg，所以這裡改用
  // icons/app-logo.png，且只在「非打包」時執行——正式版本完全不跑這段，
  // 避免又對著 .icns 路徑呼叫 setIcon 而炸出 UnhandledPromiseRejectionWarning。
  if (process.platform === "darwin" && app.dock && !app.isPackaged) {
    app.dock.setIcon(path.join(__dirname, "icons", "app-logo.png"));
  }

  // App 有「自動定位目前位置」功能，桌面版也要能拿到定位權限；
  // 通知權限則是給之後可能要接的天氣警特報推播用。
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "geolocation" || permission === "notifications");
  });

  // 自訂標題列的縮小／放大／關閉鈕實際動作：注入的頁面透過 preload.js 暴露的
  // window.mapskyWindowControls 送 IPC 過來，這裡才是真的呼叫原生視窗方法的地方。
  ipcMain.on("mapsky:window-control", (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (action === "minimize") win.minimize();
    else if (action === "maximize") {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === "close") win.close();
  });

  // 使用者在「.exe 有新版本」提示條按了「立即重新啟動安裝」，或倒數結束，
  // 頁面透過 preload 橋接送這個訊息過來，這裡才真的重啟＋安裝。
  ipcMain.on("mapsky:install-update", () => {
    autoUpdater.quitAndInstall();
  });

  // 設定頁裡「軟體更新」卡片要顯示目前版本號，從 app.getVersion() 讀
  // package.json 的 version 欄位，跟 electron-updater 比版本用的是同一個值。
  ipcMain.handle("mapsky:get-version", () => app.getVersion());

  // 更新頻道選擇器（設定頁，只有有資格的帳號才看得到選項）：讀取/切換這台
  // 電腦目前訂閱的更新頻道，實際套用邏輯在 applyUpdateChannel。
  ipcMain.handle("mapsky:get-update-channel", () => readUpdateChannel());
  ipcMain.on("mapsky:set-update-channel", (event, channel) => {
    if (!CHANNEL_MAP.hasOwnProperty(channel)) return;
    writeUpdateChannel(channel);
    applyUpdateChannel(channel);
    autoUpdater.checkForUpdates().catch(() => {});
  });

  ipcMain.handle("mapsky:local-weather", (_event, input) => lookupLocalWeather(input).catch(() => null));

  ipcMain.on("mapsky:location-failed", (event) => {
    showLocationHelp(BrowserWindow.fromWebContents(event.sender));
  });

  setupMacMenu();
  createWindow();

  // 冷啟動就是這支 App 還沒開、使用者在系統瀏覽器登入完成後，作業系統才
  // 第一次真正啟動它（不是喚醒已經在跑的實例，那個走的是上面的
  // second-instance／open-url）——這種情況網址會直接出現在這次啟動的
  // process.argv 裡，這裡補抓一次，不然這種「App 本來沒開」的情況會漏接。
  const initialUrlArg = process.argv.find((a) => a.startsWith(`${CUSTOM_PROTOCOL}://`));
  if (initialUrlArg) handleAuthCallbackUrl(initialUrlArg);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
