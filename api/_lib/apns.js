// 共用 helper：直接送 APNs（Apple Push Notification service），給 iOS 原生
// App 用。跟 web-push.js（VAPID／瀏覽器推播）是平行的兩條路，彼此不影響：
// 網頁／PWA 走 web-push.js，iOS 原生 App 走這支。
//
// 刻意不多裝一個 npm 套件（例如 node-apn）——APNs 的認證只是一個 ES256
// 簽章的 JWT（Provider Token），傳送只是一個 HTTP/2 POST，Node 內建的
// crypto／http2 兩個模組就做得到，不用為了這麼小一塊功能多背一個依賴。
//
// 需要的環境變數（跟網頁推播的 VAPID_* 是同一類東西，去 Apple Developer
// 後台的 Certificates, Identifiers & Profiles → Keys 申請一把 APNs Auth Key
// 就會拿到 Key ID／.p8 檔案內容）：
//   APNS_KEY_ID       - Auth Key 的 Key ID
//   APNS_TEAM_ID      - Apple Developer 帳號的 Team ID
//   APNS_PRIVATE_KEY  - .p8 檔案的完整內容（PEM 格式；環境變數裡如果是用
//                       單行存的，換行處會被存成字面上的 "\n"，這裡會自動
//                       還原成真正的換行）
//   APNS_BUNDLE_ID    - App 的 Bundle ID，預設 com.mapsky.weatherpro
//   APNS_ENVIRONMENT  - "production"（預設，正式上架／TestFlight 用）或
//                       "sandbox"（Xcode 直接跑在裝置上、還沒送 TestFlight
//                       的開發版 build 用；兩邊的裝置 token 不能互通，送錯
//                       環境 APNs 會回 400 BadDeviceToken）
const crypto = require("crypto");
const http2 = require("http2");

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function isConfigured() {
  return Boolean(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_PRIVATE_KEY);
}

// Provider Token 官方建議可以重複使用到 1 小時，這裡快取著，不用每次送推播
// 都重新簽一次；跟 web-push.js 的 ensureConfigured 快取邏輯是同樣的用意。
let cachedToken = null;
let cachedTokenAt = 0;
const TOKEN_TTL_MS = 50 * 60 * 1000; // 50 分鐘，留一點安全邊界

function getProviderToken() {
  const now = Date.now();
  if (cachedToken && now - cachedTokenAt < TOKEN_TTL_MS) return cachedToken;

  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const privateKey = (process.env.APNS_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  const header = { alg: "ES256", kid: keyId };
  const payload = { iss: teamId, iat: Math.floor(now / 1000) };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  // APNs 的 JWT 簽章要 IEEE P1363（r||s 直接串接）那種格式，不是 Node 預設的
  // DER 編碼，一定要指定 dsaEncoding，不然 APNs 會直接拒絕這個 token。
  const signature = crypto.sign("sha256", Buffer.from(unsigned), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  cachedToken = `${unsigned}.${base64url(signature)}`;
  cachedTokenAt = now;
  return cachedToken;
}

// 回傳 { ok, status }。status 400/410 代表這個 token 已經失效（BadDeviceToken／
// Unregistered），呼叫端應該把它從資料庫刪掉，其餘狀態當一般錯誤處理、保留
// token 讓下次還能再試。
async function sendApnsPush(token, payload) {
  if (!isConfigured()) throw new Error("apns-not-configured");
  const environment = (process.env.APNS_ENVIRONMENT || "production").trim();
  const host = environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const bundleId = process.env.APNS_BUNDLE_ID || "com.mapsky.weatherpro";
  const providerToken = getProviderToken();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const client = http2.connect(host);
    client.on("error", () => finish({ ok: false, status: 0 }));

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${providerToken}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });

    let status = 0;
    let body = "";
    req.on("response", (headers) => {
      status = headers[":status"];
    });
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      client.close();
      finish({ ok: status === 200, status, body });
    });
    req.on("error", () => finish({ ok: false, status: 0 }));
    req.setTimeout(10000, () => {
      req.close();
      finish({ ok: false, status: 0 });
    });
    req.end(JSON.stringify(payload));
  });
}

module.exports = { isConfigured, sendApnsPush };
