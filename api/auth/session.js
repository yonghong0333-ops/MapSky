const { parseCookies } = require("../_lib/cookies");
const { verify } = require("../_lib/jwt");
const { isAdminSession } = require("../_lib/admin");

module.exports = function handler(req, res) {
  const cookies = parseCookies(req);
  const payload = verify(cookies.nexora_session);
  if (!payload) return res.status(200).json({ loggedIn: false });
  res.status(200).json({
    loggedIn: true,
    provider: payload.provider,
    profile: payload.profile,
    isAdmin: isAdminSession(payload),
  });
};
