const { serializeCookie } = require("../_lib/cookies");

module.exports = function handler(req, res) {
  res.setHeader("Set-Cookie", serializeCookie("nexora_session", "", { maxAge: 0 }));
  res.status(200).json({ ok: true });
};
