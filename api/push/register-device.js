// App 端（iOS 原生殼）呼叫 Capacitor 的 PushNotifications.register() 拿到
// APNs device token 之後，會打這支 API（POST）把 token 存起來；使用者在
// App 裡關閉通知權限或登出時，打 DELETE 把 token 刪掉。
//
// 不要求登入也能呼叫——目前推播是「廣播公告」性質（颱風/天氣警特報之類
// 的公告訊息），跟網頁版 Web Push 訂閱（api/push/subscribe.js，如果有的話）
// 是同一種不綁定特定使用者帳號的設計，單純就是「這台裝置要不要收公告」。
const { addToken, removeToken } = require("../_lib/apns-store");

module.exports = async function handler(req, res) {
  if (req.method === "POST") {
    const token = (req.body && req.body.token) || "";
    if (!token || typeof token !== "string") {
      return res.status(400).json({ ok: false, reason: "missing-token" });
    }
    const ok = await addToken(token);
    return res.status(ok ? 200 : 500).json({ ok });
  }

  if (req.method === "DELETE") {
    const token = (req.body && req.body.token) || "";
    if (!token || typeof token !== "string") {
      return res.status(400).json({ ok: false, reason: "missing-token" });
    }
    const ok = await removeToken(token);
    return res.status(ok ? 200 : 500).json({ ok });
  }

  res.setHeader("Allow", "POST, DELETE");
  return res.status(405).json({ ok: false, reason: "method-not-allowed" });
};
