const { getWindObservation } = require("../_lib/cwa");
const { getCloudObservation } = require("../_lib/cloud-obs");
const { requireSession } = require("../_lib/require-session");

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;
  try {
    // 雲量：GET /api/weather/cloud 或 /api/weather/wind?type=cloud
    // 可選 county=高雄市
    if (req.query.type === "cloud" || req.query.type === "cloud-cover") {
      const result = await getCloudObservation({
        forceRefresh: req.query.refresh === "1",
        county: req.query.county || req.query.label || null,
      });
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.status(result.ok ? 200 : 502).json(result);
    }

    const result = await getWindObservation({ forceRefresh: req.query.refresh === "1" });
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ ok: false, reason: e.message });
  }
};
