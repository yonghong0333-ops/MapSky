const { getWindObservation } = require("../_lib/cwa");
const { getCloudObservation } = require("../_lib/cloud-obs");
const { handleKrtcQuery } = require("../_lib/krtc");
const { requireSession } = require("../_lib/require-session");

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;
  try {
    // 雲量：GET /api/weather/cloud 或 /api/weather/wind?type=cloud
    if (req.query.type === "cloud" || req.query.type === "cloud-cover") {
      const result = await getCloudObservation({
        forceRefresh: req.query.refresh === "1",
        county: req.query.county || req.query.label || null,
      });
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.status(result.ok ? 200 : 502).json(result);
    }

    // 高雄捷運／輕軌：GET /api/transit/krtc 或 /api/weather/wind?type=krtc
    if (
      req.query.type === "krtc" ||
      req.query.type === "metro" ||
      req.query.type === "kaohsiung-mrt"
    ) {
      const result = await handleKrtcQuery(req.query);
      const status = result.ok ? 200 : result.reason === "tdx-not-configured" ? 503 : 502;
      res.setHeader("Cache-Control", "no-store");
      return res.status(status).json(result);
    }

    const result = await getWindObservation({ forceRefresh: req.query.refresh === "1" });
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ ok: false, reason: e.message });
  }
};
