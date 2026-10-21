/**
 * YouBike 2.0 即時站況（預設高雄）
 * 資料源：官方統一 feed https://apis.youbike.com.tw/json/station-yb2.json
 * vercel rewrite：/api/transit/youbike -> wind?transit=youbike
 *
 * type=
 *   stations | list     全部（可 q / district / city）
 *   nearby              需 lat, lon；可選 radiusKm（預設 1.2）
 *   station             需 stationId / sno
 *   summary             使用說明
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const FEED_URL = "https://apis.youbike.com.tw/json/station-yb2.json";
const CACHE_TTL_MS = 60 * 1000;

// area_code 12 = 高雄；站碼 5012xxxx 為高雄市 YouBike2.0
const CITY_FILTERS = {
  kaohsiung: { areaCodes: ["12"], prefixes: ["5012", "5013", "5014"], label: "高雄" },
  taipei: { areaCodes: ["00", "01"], prefixes: ["5001", "5002"], label: "臺北" },
  newtaipei: { areaCodes: ["05"], prefixes: ["5002", "5003"], label: "新北" },
  taichung: { areaCodes: ["07", "08"], prefixes: ["5007", "5008"], label: "臺中" },
  tainan: { areaCodes: ["13"], prefixes: ["5013"], label: "臺南" },
};

let memoryCache = null;

function tmpPath() {
  return path.join(os.tmpdir(), "nexora-youbike-yb2.json");
}

function readCache() {
  if (memoryCache && Date.now() - memoryCache.fetchedAt < CACHE_TTL_MS) {
    return memoryCache.data;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(tmpPath(), "utf-8"));
    if (raw && raw.fetchedAt && Date.now() - raw.fetchedAt < CACHE_TTL_MS) {
      memoryCache = raw;
      return raw.data;
    }
  } catch {
    /* no cache */
  }
  return null;
}

function writeCache(data) {
  const payload = { data, fetchedAt: Date.now() };
  memoryCache = payload;
  try {
    fs.writeFileSync(tmpPath(), JSON.stringify(payload), "utf-8");
  } catch {
    /* ignore */
  }
}

async function fetchFeed() {
  const cached = readCache();
  if (cached) return { ok: true, data: cached, cached: true };
  const resp = await fetch(FEED_URL, {
    headers: { Accept: "application/json", "User-Agent": "MapSky/1.0" },
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return { ok: false, reason: "youbike-http", status: resp.status, detail: String(t).slice(0, 200) };
  }
  const json = await resp.json();
  const list = Array.isArray(json) ? json : [];
  writeCache(list);
  return { ok: true, data: list, cached: false };
}

function normalizeCity(raw) {
  if (raw == null || raw === "") return "kaohsiung";
  const s = String(raw).trim().toLowerCase();
  if (s.includes("高雄") || s === "kh" || s === "kcg" || s === "kaohsiung") return "kaohsiung";
  if (s.includes("台北") || s.includes("臺北") || s === "taipei" || s === "tpe") return "taipei";
  if (s.includes("新北") || s === "newtaipei" || s === "ntpc") return "newtaipei";
  if (s.includes("台中") || s.includes("臺中") || s === "taichung") return "taichung";
  if (s.includes("台南") || s.includes("臺南") || s === "tainan") return "tainan";
  if (s === "all" || s === "*") return "all";
  return s;
}

function inCity(row, cityKey) {
  if (cityKey === "all") return true;
  const f = CITY_FILTERS[cityKey];
  if (!f) return true;
  const area = String(row.area_code || "");
  const sno = String(row.station_no || row.sno || "");
  if (f.areaCodes && f.areaCodes.includes(area)) return true;
  if (f.prefixes && f.prefixes.some((p) => sno.startsWith(p))) return true;
  return false;
}

function mapStation(row) {
  const detail = row.available_spaces_detail || row.sbi_detail || {};
  const available = Number(row.available_spaces != null ? row.available_spaces : row.sbi) || 0;
  const empty = Number(row.empty_spaces != null ? row.empty_spaces : row.bemp) || 0;
  const total = Number(row.parking_spaces != null ? row.parking_spaces : row.tot) || available + empty;
  const status = row.status != null ? Number(row.status) : row.act != null ? Number(row.act) : 1;
  return {
    stationId: String(row.station_no || row.sno || ""),
    nameZh: row.name_tw || row.sna || null,
    nameEn: row.name_en || row.snaen || null,
    district: row.district_tw || row.sarea || null,
    address: row.address_tw || row.ar || null,
    lat: row.lat != null ? Number(row.lat) : null,
    lon: row.lng != null ? Number(row.lng) : row.lon != null ? Number(row.lon) : null,
    totalDocks: total,
    availableBikes: available,
    emptyDocks: empty,
    bikesDetail: {
      yb2: Number(detail.yb2) || 0,
      eyb: Number(detail.eyb) || 0,
      yb1: Number(detail.yb1) || 0,
    },
    status,
    statusText: status === 1 ? "營運中" : status === 2 ? "暫停/維護" : String(status),
    updatedAt: row.updated_at || row.time || row.mday || null,
  };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function filterList(list, { city, q, district }) {
  const cityKey = normalizeCity(city);
  let rows = list.filter((r) => inCity(r, cityKey));
  if (district) {
    const d = String(district).trim();
    rows = rows.filter((r) => String(r.district_tw || r.sarea || "").includes(d));
  }
  if (q) {
    const needle = String(q).trim().toLowerCase().replace(/臺/g, "台");
    rows = rows.filter((r) => {
      const blob = `${r.name_tw || ""} ${r.address_tw || ""} ${r.district_tw || ""} ${r.station_no || ""}`
        .toLowerCase()
        .replace(/臺/g, "台");
      return blob.includes(needle);
    });
  }
  return rows.map(mapStation);
}

async function listStations({ city = "kaohsiung", q = null, district = null } = {}) {
  const feed = await fetchFeed();
  if (!feed.ok) return feed;
  const stations = filterList(feed.data, { city, q, district });
  stations.sort((a, b) => String(a.stationId).localeCompare(String(b.stationId)));
  return {
    ok: true,
    city: normalizeCity(city),
    cached: feed.cached,
    count: stations.length,
    stations,
    updatedAt: new Date().toISOString(),
  };
}

async function nearbyStations({ lat, lon, radiusKm = 1.2, city = "kaohsiung", limit = 30 } = {}) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) {
    return { ok: false, reason: "missing-lat-lon", hint: "請帶 lat、lon" };
  }
  const feed = await fetchFeed();
  if (!feed.ok) return feed;
  const r = Math.max(0.1, Number(radiusKm) || 1.2);
  const cityKey = normalizeCity(city);
  const hits = [];
  for (const row of feed.data) {
    if (!inCity(row, cityKey)) continue;
    const s = mapStation(row);
    if (s.lat == null || s.lon == null) continue;
    const dist = haversineKm(la, lo, s.lat, s.lon);
    if (dist <= r) hits.push({ ...s, distanceKm: Math.round(dist * 1000) / 1000 });
  }
  hits.sort((a, b) => a.distanceKm - b.distanceKm);
  const stations = hits.slice(0, Math.min(100, Number(limit) || 30));
  return {
    ok: true,
    city: cityKey,
    lat: la,
    lon: lo,
    radiusKm: r,
    count: stations.length,
    stations,
    cached: feed.cached,
    updatedAt: new Date().toISOString(),
  };
}

async function oneStation({ stationId, city = "all" } = {}) {
  const sid = String(stationId || "").trim();
  if (!sid) return { ok: false, reason: "missing-stationId", hint: "請帶 stationId（如 501201001）" };
  const feed = await fetchFeed();
  if (!feed.ok) return feed;
  const row = feed.data.find((r) => String(r.station_no || r.sno || "") === sid);
  if (!row) return { ok: false, reason: "not-found", stationId: sid };
  return { ok: true, station: mapStation(row), cached: feed.cached };
}

async function handleYoubikeQuery(query) {
  const q = query || {};
  const type = String(q.type || q.action || "summary").toLowerCase();
  const city = q.city || q.county || "kaohsiung";

  if (type === "stations" || type === "list") {
    return listStations({ city, q: q.q || q.keyword || q.name || null, district: q.district || q.sarea || null });
  }
  if (type === "nearby" || type === "near") {
    return nearbyStations({
      lat: q.lat,
      lon: q.lon || q.lng,
      radiusKm: q.radiusKm || q.radius || 1.2,
      city,
      limit: q.limit || 30,
    });
  }
  if (type === "station" || type === "detail") {
    return oneStation({ stationId: q.stationId || q.sno || q.id, city });
  }

  return {
    ok: true,
    service: "youbike2",
    defaultCity: "kaohsiung",
    usage: {
      stations: "?type=stations&city=kaohsiung",
      search: "?type=stations&city=kaohsiung&q=美麗島",
      district: "?type=stations&district=左營",
      nearby: "?type=nearby&lat=22.6273&lon=120.3014&radiusKm=1",
      station: "?type=station&stationId=501201001",
    },
    note: "預設高雄 YouBike 2.0；資料來自官方統一 feed，約 1 分鐘快取。",
  };
}

module.exports = {
  handleYoubikeQuery,
  listStations,
  nearbyStations,
  oneStation,
};
