/**
 * MapSky 統一上下文 API
 * GET/POST /api/mapsky/context
 *
 * Query / Body:
 *   city       縣市名（臺北市、高雄市…）
 *   placeName  地點名稱（可選）
 *   lat, lon   座標（可選）
 *   include    逗號分隔：weather,alerts（預設兩者都有）
 *   refresh=1  強制略過快取
 *
 * 需登入（與 /api/weather/* 相同）。
 * 給 App 顯示、或給 Aether 組 context 用。
 */
const { requireSession } = require("../_lib/require-session");
const { getCity, getAlerts, CWA_CITIES } = require("../_lib/cwa");

function normalizeCity(name) {
  if (!name) return "";
  const s = String(name).replace(/台/g, "臺").trim();
  if (CWA_CITIES.indexOf(s) !== -1) return s;
  const map = {
    台北: "臺北市",
    臺北: "臺北市",
    台北市: "臺北市",
    新北: "新北市",
    桃園: "桃園市",
    台中: "臺中市",
    臺中: "臺中市",
    台南: "臺南市",
    臺南: "臺南市",
    高雄: "高雄市",
    基隆: "基隆市",
    新竹: "新竹市",
    嘉義: "嘉義市",
    宜蘭: "宜蘭縣",
    花蓮: "花蓮縣",
    台東: "臺東縣",
    臺東: "臺東縣",
    屏東: "屏東縣",
    苗栗: "苗栗縣",
    彰化: "彰化縣",
    南投: "南投縣",
    雲林: "雲林縣",
    澎湖: "澎湖縣",
    金門: "金門縣",
    馬祖: "連江縣",
    連江: "連江縣",
  };
  if (map[s]) return map[s];
  for (const city of CWA_CITIES) {
    if (city.indexOf(s) !== -1 || s.indexOf(city.replace(/[市縣]/g, "")) !== -1) return city;
  }
  return "";
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  return body || {};
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!requireSession(req, res)) return;

  const body = req.method === "POST" ? parseBody(req) : {};
  const q = req.query || {};

  const cityRaw = body.city || q.city || "";
  const placeName = body.placeName || body.place || q.placeName || "";
  const lat =
    typeof body.lat === "number"
      ? body.lat
      : typeof body.latitude === "number"
        ? body.latitude
        : q.lat != null
          ? Number(q.lat)
          : null;
  const lon =
    typeof body.lon === "number"
      ? body.lon
      : typeof body.longitude === "number"
        ? body.longitude
        : q.lon != null
          ? Number(q.lon)
          : null;

  const includeRaw = String(body.include || q.include || "weather,alerts");
  const include = includeRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const wantWeather = include.indexOf("weather") !== -1 || include.indexOf("all") !== -1;
  const wantAlerts = include.indexOf("alerts") !== -1 || include.indexOf("all") !== -1;
  const forceRefresh = q.refresh === "1" || body.refresh === true || body.refresh === "1";

  const city = normalizeCity(cityRaw) || (wantWeather ? "臺北市" : "");
  const out = {
    ok: true,
    mapsky: true,
    city: city || null,
    placeName: placeName || null,
    location:
      lat != null && lon != null && !Number.isNaN(lat) && !Number.isNaN(lon)
        ? { lat, lon }
        : null,
    weather: null,
    alerts: null,
    notes: [],
  };

  if (wantWeather && city) {
    try {
      const wx = await getCity(city, { forceRefresh });
      out.weather = wx;
      if (!cityRaw && city === "臺北市") {
        out.notes.push("未指定縣市，天氣以臺北市為參考");
      }
    } catch (e) {
      out.weather = { ok: false, reason: String((e && e.message) || e) };
    }
  }

  if (wantAlerts) {
    try {
      out.alerts = await getAlerts({ forceRefresh });
    } catch (e) {
      out.alerts = { ok: false, reason: String((e && e.message) || e) };
    }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(out);
};
