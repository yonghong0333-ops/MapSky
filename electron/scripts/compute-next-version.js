// 算下一個桌面版版本號，規則是 YY.N：
//   YY = 今年年份末兩碼（例如 2026 → "26"）
//   N  = 這個年度累計第幾版，正式版／公開測試版／一般測試版共用同一組
//        流水號（不分開算），從現有的 GitHub Releases tag 裡找目前年度
//        最大的 N，+1 就是下一個版本。
//
// package.json 的 version 欄位需要合法的 semver（三段式），所以實際存的
// 是 "YY.N.0"，測試版頻道再加上 prerelease 標籤：
//   正式版（stable）        → "26.3.0"
//   公開測試版（public-beta）→ "26.3.0-beta.1"
//   一般測試版（internal-beta）→ "26.3.0-alpha.1"
// electron-builder 看到 prerelease 標籤會自動用對應的更新頻道檔名
// （latest.yml / beta.yml / alpha.yml），不用另外設定 channel。
//
// 用法：node compute-next-version.js <channel>
// 輸出：版本號字串印到 stdout（給 workflow 用 $GITHUB_OUTPUT 接住）

const https = require("https");

const CHANNEL_SUFFIX = {
  stable: "",
  "public-beta": "-beta.1",
  "internal-beta": "-alpha.1",
};

const channel = process.argv[2];
if (!(channel in CHANNEL_SUFFIX)) {
  console.error(`未知的頻道：${channel}，只能是 stable / public-beta / internal-beta`);
  process.exit(1);
}

const REPO = "yonghong0333-ops/MapSky";
const token = process.env.GITHUB_TOKEN;

function getJson(path) {
  return new Promise((resolve, reject) => {
    https
      .get(
        {
          hostname: "api.github.com",
          path,
          headers: {
            "User-Agent": "mapsky-desktop-ci",
            Authorization: token ? `Bearer ${token}` : undefined,
            Accept: "application/vnd.github+json",
          },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            if (res.statusCode >= 300) {
              return reject(new Error(`GitHub API ${res.statusCode}: ${data}`));
            }
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        }
      )
      .on("error", reject);
  });
}

(async () => {
  const yy = String(new Date().getFullYear()).slice(-2);

  let releases = [];
  try {
    releases = await getJson(`/repos/${REPO}/releases?per_page=100`);
  } catch (e) {
    // 第一次發布、repo 還沒有任何 Release 的時候會查失敗或拿到空陣列，
    // 當作「今年還沒有任何版本」處理，N 從 1 開始，不要整個失敗。
    releases = [];
  }

  let maxN = 0;
  for (const r of Array.isArray(releases) ? releases : []) {
    const tag = String(r.tag_name || "");
    const m = /^v?(\d{2})\.(\d+)\.0/.exec(tag);
    if (m && m[1] === yy) maxN = Math.max(maxN, parseInt(m[2], 10));
  }
  const n = maxN + 1;
  const version = `${yy}.${n}.0${CHANNEL_SUFFIX[channel]}`;

  process.stdout.write(version);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
