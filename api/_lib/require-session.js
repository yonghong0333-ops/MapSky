// 共用 helper：weather/* 這幾支 API 一律要求先登入才能呼叫。
// 只擋前端 UI 不夠，因為 /api/weather/* 本身也是公開網址，
// 沒有這層檢查的話，跳過畫面直接打 API 一樣拿得到資料。
const { parseCookies } = require("./cookies");
const { verify } = require("./jwt");

// 回傳登入者的 session payload；沒登入就直接回 401 並回傳 null，
// 呼叫端在收到 null 時直接 return，不要再往下執行。
function requireSession(req, res) {
  const cookies = parseCookies(req);
  const payload = verify(cookies.nexora_session);
  if (!payload) {
    res.status(401).json({ ok: false, reason: "not-authenticated" });
    return null;
  }
  return payload;
}

module.exports = { requireSession };
