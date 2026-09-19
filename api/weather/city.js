const { getCity } = require("../_lib/cwa");
const { requireSession } = require("../_lib/require-session");

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;
  const label = req.query.label;
  if (!label) return res.status(400).json({ ok: false, reason: "missing-label" });
  try {
    const result = await getCity(String(label), { forceRefresh: req.query.refresh === "1" });
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ ok: false, reason: e.message });
  }
};
