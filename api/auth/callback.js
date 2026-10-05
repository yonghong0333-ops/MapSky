const crypto = require("crypto");
const { PROVIDERS, redirectUriFor } = require("../_lib/providers");
const { parseCookies, serializeCookie } = require("../_lib/cookies");
const { sign, verify } = require("../_lib/jwt");
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
  "magic-link-invalid": {
    why: "這組登入連結已經過期或不是有效的連結。",
    tips: ["Email 驗證連結 15 分鐘後會自動失效，請回到 MapSky 重新寄一次。", "請確認點的是信件裡完整的連結，不是被信箱軟體截斷過的網址。"],
  },
  "magic-link-used": {
    why: "這組登入連結已經用過了。",
    tips: ["Email 驗證連結只能用一次，如果已經登入成功，直接關掉這個分頁就好；還沒登入的話請回到 MapSky 重新寄一次。"],
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

// 桌面版登入的備援驗證（見 login.js 的說明）：讀出並刪除伺服器上記的 desktop_flow:<state>，
// 值要等於這次的 provider。刪除是為了只能用一次。
async function consumeDesktopFlow(state, providerId) {
  if (!/^[0-9a-f]{32}$/.test(String(state || ""))) return false;
  try {
    const client = await getRedisClient();
    if (!client) return false;
    const key = `desktop_flow:${state}`;
    let value;
    if (client.getDel) {
      value = await client.getDel(key);
    } else {
      value = await client.get(key);
      if (value) await client.del(key);
    }
    return value === providerId;
  } catch (e) {
    return false;
  }
}

function parseStateEntries(raw) {
  return String(raw || "")
    .split(",")
    .filter((e) => /^[0-9a-f]{32}(~d)?$/.test(e));
}

// Magic Link 驗證收尾：跟 OAuth 登入完全共用最後一步（同一個 sign()、
// 同一個 nexora_session cookie、同樣 302 回首頁）——對這個 App 其餘部分
// （後台管理權限判斷、會員 ID、個人資料、推播訂閱…全部都是看
// `${provider}:${profile.id}` 這把 key）來說，Magic Link 登入進來的使用者
// 就是 provider 是 "email"、id 是信箱本身的一個普通帳號，不用另外改任何
// 地方配合。email 沒有大頭貼、暱稱預設用信箱——使用者登入後可以在設定頁
// 照一般流程自己改。
// ⚠️ 這支拆成 GET／POST 兩步，不是多餘的——Gmail App（還有不少公司信箱的
// 安全閘道）收到信會自動幫使用者「預先打開」信裡的連結做安全掃描，搶在
// 使用者自己真的點之前先 GET 一次。如果 GET 就直接消費 token、設 cookie，
// 掃描器會把 token 用掉，使用者自己點的時候就已經是「這組連結已經用過了」
// ——這是真實發生過的狀況（不是假設）。拆成兩步之後：
//   GET  只驗證 token 有效，不消費、不設 cookie，回傳一個「請點這裡繼續」
//        的中繼頁，頁面載入後用 JS 自動送出下面那個表單。
//   POST 才是真正消費 token、設 cookie、算登入成功的那一步。安全掃描器
//        通常只做 GET 預覽、不會執行頁面裡的 JS、更不會自己送出表單，
//        就不會誤觸發這一步；使用者自己打開頁面才會真的執行 JS、完成登入。
//   （頁面裡同時留一個手動按鈕當 JS 被瀏覽器擋掉時的備援，按下去一樣是
//    送出同一個表單，不依賴 JS 一定要能跑。）
async function handleEmailVerify(req, res) {
  const token = req.query.token;
  const payload = token && verify(String(token));
  if (!payload || payload.purpose !== "magic-link" || !payload.email) {
    return sendLoginError(res, "magic-link-invalid");
  }

  const usedKey = `magiclink:used:${token}`;

  if (req.method === "POST") {
    // 單次有效：真正消費的這一步才標記用過，防止信件被轉寄或連結外流後
    // 重複使用。沒接 Redis 的環境（本機開發）就跳過這層，只靠 15 分鐘的
    // 到期時間擋，不影響正常登入。
    try {
      const client = await getRedisClient();
      if (client) {
        if (await client.get(usedKey)) return sendLoginError(res, "magic-link-used");
        await client.set(usedKey, "1", { EX: 900 });
      }
    } catch (e) {
      console.error("magic-link consume check failed", e.message);
    }

    const sessionToken = sign({
      provider: "email",
      profile: { id: payload.email, name: payload.email, avatarUrl: null },
    });
    res.setHeader("Set-Cookie", serializeCookie("nexora_session", sessionToken, { maxAge: 60 * 60 * 24 * 7 }));
    res.writeHead(302, { Location: "/?login=success" });
    return res.end();
  }

  // GET：先看看是不是已經被消費過了（例如掃描器已經點過、或使用者自己
  // 已經完成登入又重新整理這一頁），是的話直接顯示「已使用過」，不要讓
  // 使用者又點一次按鈕却還是失敗、搞不清楚狀況。
  try {
    const client = await getRedisClient();
    if (client && (await client.get(usedKey))) {
      return sendLoginError(res, "magic-link-used");
    }
  } catch (e) {
    console.error("magic-link pre-check failed", e.message);
  }

  const verifyAction = `/api/auth/callback?provider=email&token=${encodeURIComponent(String(token))}`;
  const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>登入 MapSky</title></head>
<body style="font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif;max-width:420px;margin:80px auto;padding:0 24px;text-align:center;color:#1f2937">
<h2>正在登入 MapSky…</h2>
<p style="color:#6b7280;line-height:1.7">請稍候，如果幾秒內沒有自動繼續，請按下面的按鈕。</p>
<form id="magicLinkForm" method="POST" action="${verifyAction}">
  <button type="submit" style="margin-top:16px;padding:12px 28px;background:#1d4ed8;color:#fff;border:0;border-radius:999px;font-size:15px;font-weight:700;">繼續登入</button>
</form>
<script>
  setTimeout(function () {
    var f = document.getElementById("magicLinkForm");
    if (f.requestSubmit) f.requestSubmit(); else f.submit();
  }, 300);
</script>
</body></html>`;
  res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
}

module.exports = async function handler(req, res) {
  if (req.query.provider === "email") {
    return handleEmailVerify(req, res);
  }

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
  let isDesktop = false;
  if (matchedEntry) {
    isDesktop = matchedEntry.endsWith("~d");
    // 桌面版有 cookie 也順便把伺服器上那筆紀錄刪掉，維持只能用一次
    if (isDesktop) await consumeDesktopFlow(req.query.state, providerId);
  } else if (await consumeDesktopFlow(req.query.state, providerId)) {
    // 沒收到 cookie，但這個 state 是伺服器記得的桌面版登入 → 放行
    isDesktop = true;
  } else {
    return sendLoginError(res, cookies.oauth_state ? "state-mismatch" : "no-cookie");
  }
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
