const { getApiKey } = require("../_lib/cwa");
const { requireSession } = require("../_lib/require-session");

module.exports = function handler(req, res) {
  if (!requireSession(req, res)) return;
  res.status(200).json({ hasKey: Boolean(getApiKey()) });
};
