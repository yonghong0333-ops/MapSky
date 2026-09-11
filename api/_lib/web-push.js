// 共用 helper：包裝 web-push 套件，統一在這裡設定 VAPID 金鑰，
// 避免每支呼叫的地方都要重複 setVapidDetails。
const webpush = require("web-push");

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!publicKey || !privateKey) return false;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (e) {
    // 金鑰格式不對（例如貼漏字、多空白）web-push 會直接 throw，
    // 不接住的話整支 serverless function 會 500，前端只會看到很籠統的錯誤。
    console.error("VAPID 金鑰格式錯誤", e.message);
    return false;
  }
  configured = true;
  return true;
}

function getPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

// 回傳 { ok, expired }。expired 代表對方已經取消訂閱／清過快取，
// 呼叫端應該把這筆訂閱從清單裡刪掉，不用當成錯誤處理。
async function sendPush(subscription, payload) {
  if (!ensureConfigured()) throw new Error("vapid-not-configured");
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true, expired: false };
  } catch (e) {
    const expired = e.statusCode === 404 || e.statusCode === 410;
    if (!expired) console.error("web-push send error", e.statusCode, e.body);
    return { ok: false, expired };
  }
}

module.exports = { ensureConfigured, getPublicKey, sendPush };
