const { getRedisClient } = require("../_lib/redis-client");

// 桌面殼收到 mapsky://login-complete?xchg=... 之後，拿交換碼呼叫這支換回
// 真正的 session token（電子行程那邊會再把換到的 token 直接寫進自己的
// cookie，見 electron/main.js 的 finishDesktopLogin）。
//
// 交換碼從 Redis 裡「讀一次就刪」：不管有沒有讀到，讀完立刻 DEL，確保同一組
// 交換碼最多只能被兌換一次——就算這組短效網址（mapsky://…）不小心被其他
// 程式或系統紀錄重複觸發，第二次以後也只會拿到「已過期或已使用」，不會讓
// 同一組交換碼被重放去偷別人的 session。
module.exports = async function handler(req, res) {
  const xchg = req.query.xchg;
  if (!xchg || typeof xchg !== "string") {
    return res.status(400).json({ error: "缺少交換碼" });
  }

  let client;
  try {
    client = await getRedisClient();
  } catch (e) {
    return res.status(502).json({ error: `連線失敗：${e.message}` });
  }
  if (!client) {
    return res.status(500).json({ error: "桌面版登入交換尚未設定（缺少 Redis 連線）" });
  }

  const key = `desktop_xchg:${xchg}`;
  // 用 GETDEL 一次做完「讀取＋刪除」，避免中間有時間差被同一組交換碼重複
  // 兌換（race condition）。
  let token;
  try {
    token = client.getDel ? await client.getDel(key) : await (async () => {
      const v = await client.get(key);
      if (v !== null) await client.del(key);
      return v;
    })();
  } catch (e) {
    return res.status(502).json({ error: `讀取交換碼失敗：${e.message}` });
  }

  if (!token) {
    return res.status(400).json({ error: "交換碼已過期或已使用過，請重新登入一次" });
  }

  return res.status(200).json({ token });
};
