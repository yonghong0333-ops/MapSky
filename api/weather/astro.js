// 合併日出日落 (sun)、月出月沒 (moon)、紫外線指數 (uv)、一週預報、
// 以及即時太陽／月亮方位角與高度角 (position) 於同一支 serverless function。
// 用 ?type= 區分——Vercel Hobby 方案對 Serverless Functions 數量有上限。
const { getSunTimes, getMoonTimes, getMoonPhaseImage, getUvIndexObservation, getWeeklyForecast } = require("../_lib/cwa");
const { computeSkyPosition } = require("../_lib/sky-position");
const { requireSession } = require("../_lib/require-session");

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;

  // 月相圖是二進位圖片
  if (req.query.type === "moonphase") {
    try {
      const jpg = await getMoonPhaseImage({ forceRefresh: req.query.refresh === "1" });
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=1800");
      res.status(200).send(jpg);
    } catch (e) {
      res.status(502).json({ ok: false, reason: e.message });
    }
    return;
  }

  // 即時太陽／月亮：方位角、高度角、赤經赤緯、月相…
  // GET /api/weather/astro?type=position&lat=22.63&lon=120.30
  // 可選 time=ISO8601
  if (req.query.type === "position" || req.query.type === "sky") {
    const lat = req.query.lat != null ? Number(req.query.lat) : null;
    const lon = req.query.lon != null ? Number(req.query.lon) : (req.query.lng != null ? Number(req.query.lng) : null);
    if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) {
      return res.status(400).json({
        ok: false,
        reason: "missing-lat-lon",
        hint: "請帶 lat、lon（或 lng），例如 ?type=position&lat=22.6273&lon=120.3014",
      });
    }
    const result = computeSkyPosition({
      lat,
      lon,
      time: req.query.time || undefined,
    });
    if (!result.ok) return res.status(400).json(result);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(result);
  }

  try {
    let result;
    if (req.query.type === "moon") {
      result = await getMoonTimes({ forceRefresh: req.query.refresh === "1" });
    } else if (req.query.type === "uv") {
      result = await getUvIndexObservation({ forceRefresh: req.query.refresh === "1" });
    } else if (req.query.type === "weekly") {
      result = await getWeeklyForecast({ forceRefresh: req.query.refresh === "1" });
    } else {
      // 預設日出日落（CWA 表）
      result = await getSunTimes({ forceRefresh: req.query.refresh === "1" });
    }
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ ok: false, reason: e.message });
  }
};
