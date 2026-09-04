// 極簡的 HMAC 簽章 session token，不用額外套件（避免多一個 npm 依賴），
// 純粹用 Node 內建 crypto 做「簽章 + Base64URL」，功能上等同一個簡化版 JWT。
const crypto = require("crypto");

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}
function base64urlJson(obj) {
  return base64url(JSON.stringify(obj));
}

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "缺少環境變數 SESSION_SECRET（用來簽章登入 session，請設定一組隨機長字串，例如用 `openssl rand -hex 32` 產生）"
    );
  }
  return secret;
}

function sign(payload, { expiresInSeconds = 60 * 60 * 24 * 7 } = {}) {
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expiresInSeconds };
  const data = base64urlJson(body);
  const sig = crypto.createHmac("sha256", getSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", getSecret()).update(data).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8"));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { sign, verify };
