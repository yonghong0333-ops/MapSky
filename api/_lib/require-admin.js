// 共用 helper：後台管理相關的資料一律要求「已登入 + 是管理員（超級或一般）」才能拿到。
// 前端把按鈕藏起來只是體驗上的方便，真正的防護一定要在後端做，
// 不然懂網址的人一樣可以繞過前端直接打 API 拿到後台資料。
const { requireSession } = require("./require-session");
const { isAdminSession } = require("./admin");

async function requireAdmin(req, res) {
  const payload = requireSession(req, res);
  if (!payload) return null; // requireSession 已經回過 401 了
  if (!(await isAdminSession(payload))) {
    res.status(403).json({ ok: false, reason: "not-admin" });
    return null;
  }
  return payload;
}

module.exports = { requireAdmin };
