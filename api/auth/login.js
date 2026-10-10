const crypto = require("crypto");
const { PROVIDERS, isConfigured, redirectUriFor, baseUrl } = require("../_lib/providers");
const { parseCookies, serializeCookie } = require("../_lib/cookies");
const { getRedisClient, inspectRedisConfig } = require("../_lib/redis-client");
const { sign } = require("../_lib/jwt");
const { resolveLoginIdentity } = require("../_lib/identity");
const { sendMagicLinkEmail } = require("../_lib/mailer");

const OTP_TTL_SECONDS = 15 * 60;
const OTP_MAX_ATTEMPTS = 5;

function hashOtp(email, code) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("缺少 SESSION_SECRET");
  return crypto.createHmac("sha256", secret).update(`ml-otp:${email}:${code}`).digest("hex");
}

function otpMatches(stored, incomingHash) {
  if (typeof stored !== "string" || typeof incomingHash !== "string") return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(incomingHash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function getRedis() {
  try {
    return await getRedisClient();
  } catch (e) {
    return null;
  }
}

async function handleSendMagicLink(req, res) {
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const email = String((body && body.email) || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, reason: "invalid-email" });
  }

  const client = await getRedis();
  if (!client) {
    return res.status(503).json({ ok: false, reason: "otp-unavailable" });
  }

  const rateKey = `magiclink:rate:${email}`;
  if (await client.get(rateKey)) {
    return res.status(429).json({ ok: false, reason: "too-soon" });
  }
  await client.set(rateKey, "1", { EX: 30 });

  // 6 位數、含前導 0，信件與輸入框都當字串比對
  const otpCode = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await client.set(`magiclink:otp:${email}`, hashOtp(email, otpCode), { EX: OTP_TTL_SECONDS });
  // 明文僅供「點連結後判斷無法跳轉」時在頁面顯示，不進信件
  await client.set(`magiclink:otp-plain:${email}`, otpCode, { EX: OTP_TTL_SECONDS });
  await client.del(`magiclink:otp-tries:${email}`);

  // 裝置綁定：前端送來的 deviceId 寫進 token，並設 HttpOnly cookie。
  // 點信連結時若 cookie 吻合 → 同裝置直接登入；否則改要求驗證碼。
  const deviceId = String((body && body.deviceId) || "").trim().slice(0, 64);
  const tokenPayload = { purpose: "magic-link", email };
  if (deviceId && /^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) {
    tokenPayload.deviceId = deviceId;
  }
  const token = sign(tokenPayload, { expiresInSeconds: OTP_TTL_SECONDS });
  const verifyUrl = `${baseUrl(req)}/api/auth/callback?provider=email&token=${encodeURIComponent(token)}`;

  try {
    await sendMagicLinkEmail(email, verifyUrl, otpCode);
  } catch (e) {
    console.error("sendMagicLinkEmail failed", e.message);
    try { await client.del(`magiclink:otp:${email}`); await client.del(`magiclink:otp-plain:${email}`); } catch (_) {}
    return res.status(502).json({ ok: false, reason: "send-failed", message: e.message });
  }

  const cookiesOut = [];
  if (tokenPayload.deviceId) {
    cookiesOut.push(serializeCookie("mapsky_ml_device", tokenPayload.deviceId, { maxAge: OTP_TTL_SECONDS }));
  }
  if (cookiesOut.length) res.setHeader("Set-Cookie", cookiesOut);
  // 驗證碼只出現在信件裡，絕不回傳給前端
  return res.status(200).json({ ok: true });
}

async function handleVerifyOtp(req, res) {
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const email = String((body && body.email) || "").trim().toLowerCase();
  const code = String((body && body.code) || "").replace(/\D/g, "").slice(0, 6);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, reason: "invalid-email" });
  }
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ ok: false, reason: "invalid-code" });
  }
  const client = await getRedis();
  if (!client) {
    return res.status(503).json({ ok: false, reason: "otp-unavailable" });
  }
  const triesKey = `magiclink:otp-tries:${email}`;
  const tries = Number((await client.get(triesKey)) || 0);
  if (tries >= OTP_MAX_ATTEMPTS) {
    return res.status(429).json({ ok: false, reason: "too-many-attempts" });
  }

  const otpKey = `magiclink:otp:${email}`;
  const stored = await client.get(otpKey);
  let incoming = "";
  try {
    incoming = hashOtp(email, code);
  } catch (e) {
    return res.status(503).json({ ok: false, reason: "otp-unavailable" });
  }
  if (!otpMatches(stored, incoming) && !(stored && stored.length === 6 && otpMatches(stored, code))) {
    await client.set(triesKey, String(tries + 1), { EX: OTP_TTL_SECONDS });
    return res.status(401).json({ ok: false, reason: "wrong-code" });
  }
  await client.del(otpKey);
  await client.del(`magiclink:otp-plain:${email}`);
  await client.del(triesKey);
  const magicLinkProfile = { id: email, name: email, avatarUrl: null, email };
  const resolved = await resolveLoginIdentity("email", magicLinkProfile);
  const sessionToken = sign({ provider: resolved.provider, profile: resolved.profile });
  res.setHeader("Set-Cookie", serializeCookie("nexora_session", sessionToken, { maxAge: 60 * 60 * 24 * 7 }));

  // 給原生 App 用的短效交換碼（與 magic-link / OAuth 同一套 desktop_xchg）
  let xchg = null;
  try {
    xchg = crypto.randomBytes(24).toString("base64url");
    await client.set(`desktop_xchg:${xchg}`, sessionToken, { EX: 60 });
  } catch (e) {
    console.error("otp store xchg failed", e.message);
    xchg = null;
  }
  return res.status(200).json({ ok: true, xchg });
}

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
    if (req.query.redirect === "1") return sendExchangeError(res, "交換碼已過期或已使用過，請重新登入一次");
    return res.status(400).json({ error: "交換碼已過期或已使用過，請重新登入一次" });
  }

  if (req.query.redirect === "1") {
    res.setHeader("Set-Cookie", serializeCookie("nexora_session", token, { maxAge: 60 * 60 * 24 * 7 }));
    res.writeHead(302, { Location: "/?login=success" });
    return res.end();
  }

  return res.status(200).json({ token });
}

function sendExchangeError(res, message) {
  const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>登入失敗 - MapSky</title></head>
<body style="font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif;max-width:560px;margin:48px auto;padding:0 20px;line-height:1.7;color:#1f2937">
<h2>登入失敗</h2>
<p>${message}</p>
<p><a href="/" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#fff;border-radius:8px;text-decoration:none">回到 MapSky 重新登入</a></p>
</body></html>`;
  res.status(400).setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
}

module.exports = async function handler(req, res) {
  if (String(req.query.redisShape || "") === "1") {
    const info = inspectRedisConfig();
    let ping = "skipped";
    if (info.connectable) {
      try {
        const client = await getRedisClient();
        if (!client) ping = "no-client";
        else ping = (await client.ping()) === "PONG" ? "ok" : "unexpected";
      } catch (e) {
        ping = "fail";
      }
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ...info, ping });
  }

  if (req.method === "POST" && req.query.provider === "email") {
    if (req.query.action === "verify-code") {
      return handleVerifyOtp(req, res);
    }
    return handleSendMagicLink(req, res);
  }
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

  // X / Twitter OAuth 2.0 需要 PKCE
  let pkceCookie = "";
  if (provider.pkce) {
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");
    pkceCookie = serializeCookie("oauth_pkce", `${state}.${codeVerifier}`, { maxAge: 600 });
  }

  const isDesktop = req.query.desktop === "1";

  const pending = String(parseCookies(req).oauth_state || "")
    .split(",")
    .filter((e) => /^[0-9a-f]{32}(~d)?$/.test(e))
    .slice(-4);
  const entry = isDesktop ? `${state}~d` : state;

  if (isDesktop) {
    try {
      const client = await getRedisClient();
      if (client) await client.set(`desktop_flow:${state}`, providerId, { EX: 900 });
    } catch (e) {
      console.error("desktop_flow store failed", e.message);
    }
  }

  const cookiesOut = [
    serializeCookie("oauth_state", [...pending, entry].join(","), { maxAge: 600 }),
    serializeCookie("oauth_provider", providerId, { maxAge: 600 }),
    serializeCookie("oauth_desktop", "", { maxAge: 0 }),
  ];
  if (pkceCookie) cookiesOut.push(pkceCookie);
  res.setHeader("Set-Cookie", cookiesOut);
  res.writeHead(302, { Location: `${provider.authorizeUrl}?${params.toString()}` });
  res.end();
};
