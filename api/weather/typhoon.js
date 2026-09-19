const { getTyphoonProbability } = require("../_lib/cwa");

module.exports = async function handler(req, res) {
  try {
    const result = await getTyphoonProbability({ forceRefresh: req.query.refresh === "1" });
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ ok: false, reason: e.message });
  }
};
