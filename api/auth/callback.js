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

// 登入驗證失敗時顯示的頁面：把原因講清楚（以前只有一行白底黑字），並附上錯誤代碼，
// 使用者截圖給我們就能分辨是哪一種。
const LOGIN_ERROR_TEXT = {
  "no-cookie": {
    why: "瀏覽器沒有把登入用的暫存資料（Cookie）帶回來。",
    tips: [
      "瀏覽器或擴充功能封鎖了 Cookie（學校、公司管理的電腦常見）。請允許 mapskyapp.vercel.app 使用 Cookie，或改用無痕視窗試一次。",
      "登入超過 10 分鐘才完成，暫存資料已經過期。請一次做完。",
      "登入是在另一個瀏覽器、另一個設定檔或無痕視窗開始的。請在同一個視窗完成。",
      "登入其實已經成功，只是這個頁面被重新整理、或從歷史紀錄打開。如果 MapSky App 已經登入，直接關掉這個分頁就好。",
    ],
  },
  "state-mismatch": {
    why: "這個登入頁面已經失效，跟目前瀏覽器記得的登入對不上。",
    tips: [
      "同時開了很多個登入分頁，或短時間內連按了很多次登入。請關掉其他登入分頁，回到 MapSky 只按一次登入。",
      "這個頁面是登入完成後重新整理、或從歷史紀錄打開的。如果 MapSky App 已經登入成功，直接關掉這個分頁就好。",
    ],
  },
  "missing-params": {
    why: "登入資料不完整。",
    tips: ["請回到 MapSky 重新按一次登入。"],
  },
};

function sendLoginError(res, code) {
  const info = LOGIN_ERROR_TEXT[code] || LOGIN_ERROR_TEXT["missing-params"];
  const items = info.tips.map((t) => `<li>${t}</li>`).join("");
  const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>登入驗證失敗 - MapSky</title></head>
<body style="font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif;max-width:560px;margin:48px auto;padding:0 20px;line-height:1.7;color:#1f2937">
<h2>登入驗證失敗</h2>
<p>${info.why}</p>
<p>可能的原因：</p>
<ul>${items}</ul>
<p><a href="/" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#fff;border-radius:8px;text-decoration:none">回到 MapSky 重新登入</a></p>
<p style="color:#9ca3af;font-size:12px">錯誤代碼：${code}</p>
</body></html>`;
  res.status(400).setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
}

function parseStateEntries(raw) {
  return String(raw || "")
    .split(",")
    .filter((e) => /^[0-9a-f]{32}(~d)?$/.test(e));
}

module.exports = async function handler(req, res) {
  const providerId = req.query.provider;
  const provider = PROVIDERS[providerId];
  const cookies = parseCookies(req);

  if (!provider) return res.status(400).send("未知的登入方式");

  if (req.query.error) {
    return res.redirect(302, `/?login=error&reason=${encodeURIComponent(req.query.error)}`);
  }
  if (!req.query.code || !req.query.state) return sendLoginError(res, "missing-params");
  const stateEntries = parseStateEntries(cookies.oauth_state);
  const matchedEntry = stateEntries.find((e) => e.replace(/~d$/, "") === req.query.state);
  if (!matchedEntry) {
    return sendLoginError(res, cookies.oauth_state ? "state-mismatch" : "no-cookie");
  }
  const isDesktop = matchedEntry.endsWith("~d");
  const remainingStates = stateEntries.filter((e) => e !== matchedEntry);

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

    // 清掉這次登入流程用的一次性 cookie，不管是不是桌面版都要清，避免留著
    // 被下一次登入流程誤用。oauth_state 只移除這一筆，其他還在進行中的登入流程保留。
    const clearFlowCookies = [
      remainingStates.length
        ? serializeCookie("oauth_state", remainingStates.join(","), { maxAge: 600 })
        : serializeCookie("oauth_state", "", { maxAge: 0 }),
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
