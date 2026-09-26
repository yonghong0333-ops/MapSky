// 共用 helper：直接用 Node 內建的 http2 模組打 Apple Push Notification
// service（APNs）的 Provider API，給 iOS 原生 App（@capacitor/push-notifications）
// 推播用。跟網頁版的 web-push.js 是平行的兩套系統——瀏覽器訂閱用 VAPID/
// Web Push 標準，iOS 原生 App 拿到的是 APNs device token，兩邊協定完全
// 不同，沒辦法共用同一套。
//
// 需要在 Vercel 專案設定這幾個環境變數（都是去 Apple Developer 後台申請）：
//   APNS_KEY_ID       - Certificates, Identifiers & Profiles → Keys 頁面
//                        產生 Auth Key 時給的 Key ID（10 碼英數字）
//   APNS_TEAM_ID      - 帳號設定裡的 Team ID（10 碼英數字）
//   APNS_BUNDLE_ID    - App 的 Bundle Identifier（例如 com.mapsky.weatherpro，
//                        要跟 Xcode 專案裡設定的一致）
//   APNS_PRIVATE_KEY  - 申請 Auth Key 時下載的 .p8 檔案「完整內容」，含
//                        -----BEGIN PRIVATE KEY----- / -----END PRIVATE KEY-----
//                        那兩行。.p8 只能下載一次，下載後要妥善保存。
//   APNS_PRODUCTION   - "true"：App Store 正式上架的版本要用這個；不設定
//                        或其他值：Xcode 直接 Run 到手機、TestFlight 用的
//                        沙盒環境。兩邊主機不一樣，token 只在各自環境有效，
//                        混用的話 APNs 會回 BadDeviceToken。
const crypto = require("crypto");
const http2 = require("http2");

let cachedToken = null; // { token, exp }

function base64url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Node 的 crypto.sign 對 EC 金鑰預設輸出 DER 格式（一段 ASN.1 結構）；
// JWT 的 ES256 規定要用「JOSE 格式」：r、s 兩個定長 32 bytes 直接接在一起。
// 沒有另外裝套件（例如 jsonwebtoken）處理這個轉換，這裡手動拆 DER。
function derToJose(der) {
  let offset = 2; // 跳過最外層 SEQUENCE 的 tag(1) + length(1)
  function readInt() {
    if (der[offset] !== 0x02) throw new Error("非預期的 DER 結構（不是 INTEGER）");
    offset += 1;
    const len = der[offset];
    offset += 1;
    let bytes = der.slice(offset, offset + len);
    offset += len;
    while (bytes.length > 32 && bytes[0] === 0x00) bytes = bytes.slice(1);
    if (bytes.length < 32) bytes = Buffer.concat([Buffer.alloc(32 - bytes.length), bytes]);
    return bytes;
  }
  const r = readInt();
  const s = readInt();
  return Buffer.concat([r, s]);
}

function buildProviderToken() {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const rawKey = process.env.APNS_PRIVATE_KEY;
  if (!keyId || !teamId || !rawKey) return null;

  const now = Math.floor(Date.now() / 1000);
  // Provider token 最長有效 1 小時，50 分鐘就重簽，留緩衝避免卡在邊界上失效。
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token;

  // Vercel 環境變數如果是用單行貼上、把換行存成 "\n" 字面字元的話，這裡轉回真的換行。
  const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;

  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const payload = base64url(JSON.stringify({ iss: teamId, iat: now }));
  const signingInput = `${header}.${payload}`;

  const signer = crypto.createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const der = signer.sign(privateKey);
  const signature = base64url(derToJose(der));

  const token = `${signingInput}.${signature}`;
  cachedToken = { token, exp: now + 50 * 60 };
  return token;
}

function isConfigured() {
  return Boolean(
    process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID &&
    process.env.APNS_BUNDLE_ID && process.env.APNS_PRIVATE_KEY
  );
}

// 回傳 { ok, expired }。expired 代表 APNs 說這個 token 已經失效
// （BadDeviceToken / Unregistered，通常是使用者移除 App 或關閉通知權限太久），
// 呼叫端應該把這筆 token 從清單裡刪掉，不用當成錯誤處理。
function sendApns(deviceToken, payload) {
  return new Promise((resolve) => {
    const bundleId = process.env.APNS_BUNDLE_ID;
    const providerToken = buildProviderToken();
    if (!bundleId || !providerToken) {
      resolve({ ok: false, expired: false, error: "apns-not-configured" });
      return;
    }
    const host = process.env.APNS_PRODUCTION === "true"
      ? "api.push.apple.com"
      : "api.sandbox.push.apple.com";

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const client = http2.connect(`https://${host}`);
    client.on("error", (e) => {
      console.error("APNs 連線錯誤", e.message);
      finish({ ok: false, expired: false, error: e.message });
    });
    // 保險：萬一 Apple 那邊卡住不回應，最多等 10 秒就放棄，避免整支
    // serverless function 因為單一裝置卡住而逾時，拖累其他裝置沒送到。
    const timeout = setTimeout(() => {
      client.close();
      finish({ ok: false, expired: false, error: "timeout" });
    }, 10000);

    const body = JSON.stringify({
      aps: {
        alert: { title: payload.title || "", body: payload.body || "" },
        sound: "default",
      },
      url: payload.url || undefined,
    });

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${providerToken}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });

    let status = 0;
    req.on("response", (headers) => {
      status = headers[":status"];
    });
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      clearTimeout(timeout);
      client.close();
      if (status === 200) {
        finish({ ok: true, expired: false });
        return;
      }
      const expired = status === 400 || status === 410;
      if (!expired) console.error("APNs send error", status, raw);
      finish({ ok: false, expired });
    });
    req.on("error", (e) => {
      clearTimeout(timeout);
      client.close();
      finish({ ok: false, expired: false, error: e.message });
    });
    req.end(body);
  });
}

module.exports = { sendApns, isConfigured };
