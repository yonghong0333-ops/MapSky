const crypto = require("crypto");
const { PROVIDERS, redirectUriFor } = require("../_lib/providers");
const { parseCookies, serializeCookie } = require("../_lib/cookies");
const { sign } = require("../_lib/jwt");
const { getRedisClient } = require("../_lib/redis-client");

// 桌面殼登入完成後不能直接把 session cookie 設在系統瀏覽器上（桌面殼看不到），
// 要換成一組「短效、只能用一次」的交換碼，透過 mapsky://login-complete?xchg=
// 帶回桌面殼，殼再拿交換碼去 /api/auth/exchange 換回真正的 session token。
// 交換碼本身不是 session token，猜中也沒用，Redis 一次讀取後立刻刪除，
// 60 秒沒被領走就自然過期，降低這組短效憑證外流後被重放的風險（不像
// session token 一次外流就是整整 7 天）。
const EXCHANGE_CODE_TTL_SECONDS = 60;

async function storeExchangeCode(token) {
  const client = await getRedisClient();
  if (!client) {
    throw new Error(
      "桌面版登入交換尚未設定（缺少環境變數 REDIS_URL / KV_URL，無法暫存短效交換碼）"
    );
  }
  const code = crypto.randomBytes(24).toString("base64url");
  await client.set(`desktop_xchg:${code}`, token, { EX: EXCHANGE_CODE_TTL_SECONDS });
  return code;
}

async function exchangeToken(provider, code, redirectUri) {
  const body = {
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  };

  if (provider.tokenMethod === "GET") {
    // Facebook: 官方文件走 GET + query string 換 token
    const params = new URLSearchParams(body);
    const resp = await fetch(`${provider.tokenUrl}?${params.toString()}`);
    if (!resp.ok) throw new Error(`token exchange failed: HTTP ${resp.status}`);
    return resp.json();
  }

  const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  const formBody = new URLSearchParams(body);

  if (provider.tokenAuthStyle === "basic") {
    // Yahoo: 用 Authorization: Basic 帶 client_id/secret，不放在 body
    delete body.client_id;
    delete body.client_secret;
    const formBodyNoSecret = new URLSearchParams(body);
    const basic = Buffer.from(`${provider.clientId}:${provider.clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
    const resp = await fetch(provider.tokenUrl, { method: "POST", headers, body: formBodyNoSecret.toString() });
    if (!resp.ok) throw new Error(`token exchange failed: HTTP ${resp.status}`);
    return resp.json();
  }

  const resp = await fetch(provider.tokenUrl, { method: "POST", headers, body: formBody.toString() });
  if (!resp.ok) throw new Error(`token exchange failed: HTTP ${resp.status}`);
  return resp.json();
}

module.exports = async function handler(req, res) {
  const providerId = req.query.provider;
  const provider = PROVIDERS[providerId];
  const cookies = parseCookies(req);

  if (!provider) return res.status(400).send("未知的登入方式");

  if (req.query.error) {
    return res.redirect(302, `/?login=error&reason=${encodeURIComponent(req.query.error)}`);
  }
  if (!req.query.code || !req.query.state || req.query.state !== cookies.oauth_state) {
    return res.status(400).send("登入驗證失敗（state 不符），請重新登入一次");
  }

  try {
    const redirectUri = redirectUriFor(req, providerId);
    const tokenJson = await exchangeToken(provider, req.query.code, redirectUri);
    const accessToken = tokenJson.access_token;
    if (!accessToken) throw new Error("沒有拿到 access_token");

    const profResp = await fetch(provider.profileUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profResp.ok) throw new Error(`取得個人資料失敗: HTTP ${profResp.status}`);
    const profileJson = await profResp.json();
    const profile = provider.mapProfile(profileJson);

    const token = sign({ provider: providerId, profile });
    const isDesktop = cookies.oauth_desktop === "1";

    // 清掉這次登入流程用的一次性 cookie，不管是不是桌面版都要清，避免留著
    // 被下一次登入流程誤用。
    const clearFlowCookies = [
      serializeCookie("oauth_state", "", { maxAge: 0 }),
      serializeCookie("oauth_provider", "", { maxAge: 0 }),
      serializeCookie("oauth_desktop", "", { maxAge: 0 }),
    ];

    if (isDesktop) {
      // 桌面版：不把 session cookie 設在系統瀏覽器上，換成一組短效交換碼，
      // 導去 mapsky://login-complete?xchg=...，交給桌面殼自己換回 session。
      const xchg = await storeExchangeCode(token);
      res.setHeader("Set-Cookie", clearFlowCookies);
      res.writeHead(302, { Location: `mapsky://login-complete?xchg=${encodeURIComponent(xchg)}` });
      res.end();
      return;
    }

    res.setHeader("Set-Cookie", [
      serializeCookie("nexora_session", token, { maxAge: 60 * 60 * 24 * 7 }),
      ...clearFlowCookies,
    ]);
    res.writeHead(302, { Location: "/?login=success" });
    res.end();
  } catch (e) {
    res.status(502).send(`登入失敗：${e.message}`);
  }
};
