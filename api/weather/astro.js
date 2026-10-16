const { getSunTimes, getMoonTimes, getMoonPhaseImage, getUvIndexObservation, getWeeklyForecast } = require("../_lib/cwa");
const { computeSkyPosition, computeMoonIllumination } = require("../_lib/sky-position");
const { saveLastLocation, getLastLocation } = require("../_lib/last-location");
const { resolveObserverLocation } = require("../_lib/tw-city-coords");
const { requireSession } = require("../_lib/require-session");

module.exports = async function handler(req, res) {
  const payload = requireSession(req, res);
  if (!payload) return;

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

  // 月球照亮面積百分比
  // GET /api/weather/astro?type=illumination
  // 可選 lat/lon；沒有則用上次定位；再沒有用參考點（百分比與地點幾乎無關）
  if (req.query.type === "illumination" || req.query.type === "moon-illumination") {
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
    const hasGps =
      (body.lat != null || q.lat != null) &&
      (body.lon != null || q.lon != null || body.lng != null || q.lng != null);
    let loc = null;
    if (hasGps) {
      loc = resolveObserverLocation({
        lat: body.lat != null ? body.lat : q.lat,
        lon: body.lon != null ? body.lon : q.lon,
        lng: body.lng != null ? body.lng : q.lng,
        city: body.city || q.city,
        placeName: body.placeName || body.place || q.placeName,
      });
      if (loc.ok) {
        await saveLastLocation(payload, {
          lat: loc.lat,
          lon: loc.lon,
          city: loc.city || body.city || q.city,
          placeName: loc.placeName,
        });
        loc.source = "gps";
      }
    } else if (body.city || q.city) {
      loc = resolveObserverLocation({
        city: body.city || q.city,
        placeName: body.placeName || body.place || q.placeName,
      });
      if (loc.ok) {
        await saveLastLocation(payload, {
          lat: loc.lat,
          lon: loc.lon,
          city: loc.city,
          placeName: loc.placeName,
        });
      }
    } else {
      const last = await getLastLocation(payload);
      if (last) {
        loc = {
          ok: true,
          lat: last.lat,
          lon: last.lon,
          source: "last-location",
          city: last.city,
          placeName: last.placeName,
          updatedAt: last.updatedAt,
        };
      }
    }
    if (!loc || !loc.ok) {
      loc = { ok: true, lat: 0, lon: 120, source: "reference", city: null, placeName: null };
    }
    const result = computeMoonIllumination({
      lat: loc.lat,
      lon: loc.lon,
      time: body.time || q.time || undefined,
    });
    if (!result.ok) return res.status(400).json(result);
    result.locationSource = loc.source;
    result.city = loc.city || null;
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(result);
  }

  // type=position|sky：有 lat/lon 存上次；沒有用上次；不預設縣市
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

    const hasGps =
      (body.lat != null || q.lat != null) &&
      (body.lon != null || q.lon != null || body.lng != null || q.lng != null);

    let loc = null;

    if (hasGps) {
      loc = resolveObserverLocation({
        lat: body.lat != null ? body.lat : q.lat,
        lon: body.lon != null ? body.lon : q.lon,
        lng: body.lng != null ? body.lng : q.lng,
        city: body.city || q.city,
        placeName: body.placeName || body.place || q.placeName,
      });
      if (loc.ok) {
        await saveLastLocation(payload, {
          lat: loc.lat,
          lon: loc.lon,
          city: loc.city || body.city || q.city,
          placeName: loc.placeName,
        });
        loc.source = "gps";
      }
    } else if (body.city || q.city) {
      loc = resolveObserverLocation({
        city: body.city || q.city,
        placeName: body.placeName || body.place || q.placeName,
      });
      if (loc.ok) {
        await saveLastLocation(payload, {
          lat: loc.lat,
          lon: loc.lon,
          city: loc.city,
          placeName: loc.placeName,
        });
      }
    } else {
      const last = await getLastLocation(payload);
      if (last) {
        loc = {
          ok: true,
          lat: last.lat,
          lon: last.lon,
          source: "last-location",
          city: last.city,
          placeName: last.placeName,
          updatedAt: last.updatedAt,
        };
      }
    }

    if (!loc || !loc.ok) {
      return res.status(400).json({
        ok: false,
        reason: "no-location",
        hint: "請先傳 lat+lon 寫入定位；之後沒定位會自動用上次。無預設縣市。",
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
    if (loc.updatedAt) result.locationUpdatedAt = loc.updatedAt;
    if (result.observer) {
      result.observer.source = loc.source;
      result.observer.city = loc.city || null;
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(result);
  }

  if (req.query.type === "last-location") {
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          body = {};
        }
      }
      body = body || {};
      const saved = await saveLastLocation(payload, body);
      if (!saved) {
        return res.status(400).json({ ok: false, reason: "invalid-lat-lon" });
      }
      return res.status(200).json({ ok: true, location: { ...saved, source: "gps" } });
    }
    const last = await getLastLocation(payload);
    return res.status(200).json({ ok: true, location: last });
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
