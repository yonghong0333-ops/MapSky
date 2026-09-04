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

  res.setHeader("Set-Cookie", [
    serializeCookie("oauth_state", state, { maxAge: 600 }),
    serializeCookie("oauth_provider", providerId, { maxAge: 600 }),
  ]);
  res.writeHead(302, { Location: `${provider.authorizeUrl}?${params.toString()}` });
  res.end();
};
