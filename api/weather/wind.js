const { getWindObservation } = require("../_lib/cwa");
const { getCloudObservation } = require("../_lib/cloud-obs");
const { handleKrtcQuery } = require("../_lib/krtc");
const { handleTraQuery } = require("../_lib/tra");
const { handleThsrQuery } = require("../_lib/thsr");
const { requireSession } = require("../_lib/require-session");

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;
  try {
    const q = req.query || {};
    // transit= 由 vercel rewrite 注入，不會蓋掉客戶端的 type=
    const transit = String(q.transit || "").toLowerCase();

    if (q.type === "cloud" || q.type === "cloud-cover") {
      const result = await getCloudObservation({
        forceRefresh: q.refresh === "1",
        county: q.county || q.label || null,
      });
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.status(result.ok ? 200 : 502).json(result);
    }

    if (
      transit === "krtc" ||
      q.type === "krtc" ||
      q.type === "metro" ||
      q.type === "kaohsiung-mrt"
    ) {
      // 若 rewrite 誤把 type 設成 krtc，仍允許用 action 指定
      const query = { ...q };
      if (query.type === "krtc" || query.type === "metro" || query.type === "kaohsiung-mrt") {
        delete query.type;
      }
      const result = await handleKrtcQuery(query);
      const status = result.ok ? 200 : result.reason === "tdx-not-configured" ? 503 : 502;
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
            : result.reason === "missing-stationId"
              ? 400
              : 502;
      res.setHeader("Cache-Control", "no-store");
      return res.status(status).json(result);
    }

    if (transit === "thsr" || q.type === "thsr" || q.type === "hsr" || q.type === "high-speed") {
      const query = { ...q };
      if (query.type === "thsr" || query.type === "hsr" || query.type === "high-speed") {
        delete query.type;
      }
      const result = await handleThsrQuery(query);
      const status =
        result.ok
          ? 200
          : result.reason === "tdx-not-configured"
            ? 503
            : result.reason === "missing-stations" || result.reason === "missing-stationId"
              ? 400
              : 502;
      res.setHeader("Cache-Control", "no-store");
      return res.status(status).json(result);
    }

    const result = await getWindObservation({ forceRefresh: q.refresh === "1" });
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ ok: false, reason: e.message });
  }
};
