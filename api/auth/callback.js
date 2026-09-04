const { PROVIDERS, redirectUriFor } = require("../_lib/providers");
const { parseCookies, serializeCookie } = require("../_lib/cookies");
const { sign } = require("../_lib/jwt");

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

    res.setHeader("Set-Cookie", [
      serializeCookie("nexora_session", token, { maxAge: 60 * 60 * 24 * 7 }),
      serializeCookie("oauth_state", "", { maxAge: 0 }),
      serializeCookie("oauth_provider", "", { maxAge: 0 }),
    ]);
    res.writeHead(302, { Location: "/?login=success" });
    res.end();
  } catch (e) {
    res.status(502).send(`登入失敗：${e.message}`);
  }
};
