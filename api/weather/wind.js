const { getWindObservation } = require("../_lib/cwa");
const { getCloudObservation } = require("../_lib/cloud-obs");
const { handleKrtcQuery } = require("../_lib/krtc");
const { handleTraQuery } = require("../_lib/tra");
const { handleThsrQuery } = require("../_lib/thsr");
const { handleYoubikeQuery } = require("../_lib/youbike");
const { handleSuspensionQuery } = require("../_lib/school-closure");
const { handleClosuresRequest } = require("../_lib/closures");
const { requireSession } = require("../_lib/require-session");

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;
  try {
    const q = req.query || {};
    const transit = String(q.transit || "").toLowerCase();

    if (q.type === "closures" || q.type === "closure-settings") {
      return await handleClosuresRequest(req, res);
    }

    if (q.type === "cloud" || q.type === "cloud-cover") {
      const result = await getCloudObservation({
        forceRefresh: q.refresh === "1",
        county: q.county || q.label || null,
      });
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.status(result.ok ? 200 : 502).json(result);
    }

    if (
      q.type === "suspension" ||
      q.type === "school-closure" ||
      q.type === "closure" ||
      q.type === "停班停課" ||
      q.type === "typhoon-dayoff"
    ) {
      const result = await handleSuspensionQuery(q);
      const status = result.ok ? 200 : 502;
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
      return res.status(status).json(result);
    }

    if (
      transit === "krtc" ||
      q.type === "krtc" ||
      q.type === "metro" ||
      q.type === "kaohsiung-mrt"
    ) {
      const query = { ...q };
      if (query.type === "krtc" || query.type === "metro" || query.type === "kaohsiung-mrt") {
        delete query.type;
      }
      const result = await handleKrtcQuery(query);
      const status =
        result.ok
          ? 200
          : result.reason === "tdx-not-configured"
            ? 503
            : result.reason === "tdx-rate-limit"
              ? 429
              : 502;
      res.setHeader("Cache-Control", "no-store");
      return res.status(status).json(result);
    }

    if (transit === "tra" || q.type === "tra" || q.type === "taiwan-rail" || q.type === "rail") {
      const query = { ...q };
      if (query.type === "tra" || query.type === "taiwan-rail" || query.type === "rail") {
        delete query.type;
      }
      const result = await handleTraQuery(query);
      const status =
        result.ok
          ? 200
          : result.reason === "tdx-not-configured"
            ? 503
            : result.reason === "tdx-rate-limit"
              ? 429
              : result.reason === "missing-stationId"
                ? 400
                : 502;
      res.setHeader("Cache-Control", "no-store");
      return res.status(status).json(result);
    }

    if (transit === "thsr" || q.type === "thsr" || q.type === "hsr") {
      const query = { ...q };
      if (query.type === "thsr" || query.type === "hsr") delete query.type;
      const result = await handleThsrQuery(query);
      const status =
        result.ok
          ? 200
          : result.reason === "tdx-not-configured"
            ? 503
            : result.reason === "tdx-rate-limit"
              ? 429
              : 502;
      res.setHeader("Cache-Control", "no-store");
      return res.status(status).json(result);
    }

    if (transit === "youbike" || q.type === "youbike" || q.type === "bike") {
      const query = { ...q };
      if (query.type === "youbike" || query.type === "bike") delete query.type;
      const result = await handleYoubikeQuery(query);
      const status = result.ok ? 200 : 502;
      res.setHeader("Cache-Control", "no-store");
      return res.status(status).json(result);
    }

    // default: wind observation
    const result = await getWindObservation({
      forceRefresh: q.refresh === "1",
      stationId: q.stationId || q.station || null,
      county: q.county || null,
    });
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (e) {
    console.error("[wind]", e);
    return res.status(500).json({ ok: false, reason: "internal", detail: String(e.message || e).slice(0, 200) });
  }
};
