const { getTyphoonProbability } = require("../_lib/cwa");
const { requireSession } = require("../_lib/require-session");

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;
  try {
    const result = await getTyphoonProbability({ forceRefresh: req.query.refresh === "1" });
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ ok: false, reason: e.message });
  }
};
