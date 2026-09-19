const crypto = require("crypto");
const { PROVIDERS, isConfigured, redirectUriFor } = require("../_lib/providers");
const { serializeCookie } = require("../_lib/cookies");

module.exports = function handler(req, res) {
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
