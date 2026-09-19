const crypto = require("crypto");
const { PROVIDERS, isConfigured, redirectUriFor } = require("../_lib/providers");
const { serializeCookie } = require("../_lib/cookies");
const { getRedisClient } = require("../_lib/redis-client");

// 桌面殼登入完成（api/auth/callback.js 換到短效交換碼、導回 mapsky://login-complete?xchg=...）
// 之後，會回頭呼叫這支帶 xchg 參數，換回真正的 session token。跟改暱稱／
// 推播訂閱塞進 session.js 是同一個理由：Vercel Hobby 方案一個部署最多 12 支
// function，這支本來就是登入相關，直接沿用、不用另外多開一支 exchange.js。
async function handleDesktopExchange(req, res) {
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
  // 用 GETDEL 一次做完「讀取＋刪除」，讀一次就沒了，避免同一組交換碼被重放。
  let token;
  try {
    token = client.getDel
      ? await client.getDel(key)
      : await (async () => {
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
}

module.exports = async function handler(req, res) {
  if (req.query.xchg !== undefined) {
    return handleDesktopExchange(req, res);
  }

  const providerId = req.query.provider;
  const provider = PROVIDERS[providerId];

  if (!provider) {
    return res.status(400).send("未知的登入方式");
  }
  if (!isConfigured(providerId)) {
    return res
      .status(400)
      .send(`${provider.label} 登入尚未設定（缺少環境變數 ${providerId.toUpperCase()}_CLIENT_ID / _CLIENT_SECRET）`);
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = redirectUriFor(req, providerId);

  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: provider.scope,
    state,
    ...(provider.extraAuthParams || {}),
  });

  // 桌面版打開這支網址時會多帶一個 desktop=1（見 electron/main.js 的
  // openLoginInSystemBrowser），記一個 cookie 讓 callback.js 知道「這次登入
  // 完成後要導回桌面殼」，而不是走網頁版預設的「把 session cookie 設在目前
  // 這個瀏覽器上」。這個 cookie 只是流程內部用的標記，跟 oauth_state 同樣的
  // 有效期限、同樣一次性（callback 處理完就會清掉）。
  const isDesktop = req.query.desktop === "1";

  res.setHeader("Set-Cookie", [
    serializeCookie("oauth_state", state, { maxAge: 600 }),
    serializeCookie("oauth_provider", providerId, { maxAge: 600 }),
    ...(isDesktop ? [serializeCookie("oauth_desktop", "1", { maxAge: 600 })] : []),
  ]);
  res.writeHead(302, { Location: `${provider.authorizeUrl}?${params.toString()}` });
  res.end();
};
