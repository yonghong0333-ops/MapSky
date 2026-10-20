const { getWindObservation } = require("../_lib/cwa");
const { getCloudObservation } = require("../_lib/cloud-obs");
const { handleKrtcQuery } = require("../_lib/krtc");
const { handleTraQuery } = require("../_lib/tra");
const { requireSession } = require("../_lib/require-session");

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;
  try {
    if (req.query.type === "cloud" || req.query.type === "cloud-cover") {
      const result = await getCloudObservation({
        forceRefresh: req.query.refresh === "1",
        county: req.query.county || req.query.label || null,
      });
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.status(result.ok ? 200 : 502).json(result);
    }

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

    // 臺鐵：GET /api/transit/tra 或 /api/weather/wind?type=tra
    if (req.query.type === "tra" || req.query.type === "taiwan-rail" || req.query.type === "rail") {
      const result = await handleTraQuery(req.query);
      const status = result.ok ? 200 : result.reason === "tdx-not-configured" ? 503 : result.reason === "missing-stationId" ? 400 : 502;
      res.setHeader("Cache-Control", "no-store");
      return res.status(status).json(result);
    }

    const result = await getWindObservation({ forceRefresh: req.query.refresh === "1" });
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ ok: false, reason: e.message });
  }
};
