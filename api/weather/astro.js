// 合併日出日落 (sun)、月出月沒 (moon)、紫外線指數 (uv)、一週預報、
// 以及即時太陽／月亮方位角與高度角 (position) 於同一支 serverless function。
// type=position|sky：依「定位」計算——前端傳 lat/lon，或傳 city 用縣市中心。
const { getSunTimes, getMoonTimes, getMoonPhaseImage, getUvIndexObservation, getWeeklyForecast } = require("../_lib/cwa");
const { computeSkyPosition } = require("../_lib/sky-position");
const { resolveObserverLocation } = require("../_lib/tw-city-coords");
const { requireSession } = require("../_lib/require-session");

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;

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

  // 依定位計算日月位置
  // 優先：手機 GPS → lat & lon
  // 後備：city=高雄市 → 縣市中心座標
  // GET /api/weather/astro?type=position&lat=22.6273&lon=120.3014
  // GET /api/weather/astro?type=position&city=%E9%AB%98%E9%9B%84%E5%B8%82
  if (req.query.type === "position" || req.query.type === "sky") {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    body = body || {};
    const q = req.query || {};

    const loc = resolveObserverLocation({
      lat: body.lat != null ? body.lat : q.lat,
      lon: body.lon != null ? body.lon : q.lon,
      lng: body.lng != null ? body.lng : q.lng,
      city: body.city || q.city || body.label || q.label,
      placeName: body.placeName || body.place || q.placeName,
    });

    if (!loc.ok) {
      return res.status(400).json({
        ok: false,
        reason: loc.reason || "missing-location",
        hint: loc.hint || "請傳手機定位 lat+lon，或 city=高雄市",
      });
    }

    const result = computeSkyPosition({
      lat: loc.lat,
      lon: loc.lon,
      time: body.time || q.time || undefined,
    });
    if (!result.ok) return res.status(400).json(result);

    result.locationSource = loc.source;
    result.city = loc.city || null;
    result.placeName = loc.placeName || null;
    if (result.observer) {
      result.observer.source = loc.source;
      result.observer.city = loc.city || null;
    }

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
      result = await getSunTimes({ forceRefresh: req.query.refresh === "1" });
    }
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ ok: false, reason: e.message });
  }
};
