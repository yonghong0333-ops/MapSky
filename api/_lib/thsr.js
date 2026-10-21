/**
 * 臺灣高鐵（THSR）— TDX v2
 * 環境變數：TDX_CLIENT_ID、TDX_CLIENT_SECRET（與捷運／臺鐵共用）
 *
 * 站碼：0990 南港、1000 台北、1010 板橋、1020 桃園、1030 新竹、1040 苗栗、
 *       1050 台中、1060 彰化、1070 雲林、1080 嘉義、1090 台南、1100 左營
 *
 * type= stations | lines | timetable | station-timetable | upcoming | seats | fare
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const TOKEN_URL =
  "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const API_BASE = "https://tdx.transportdata.tw/api/basic/v2/Rail/THSR";

const CACHE_TTL_STATIC_MS = 12 * 60 * 60 * 1000;
const CACHE_TTL_LIVE_MS = 5 * 60 * 1000;
const TOKEN_SKEW_MS = 60 * 1000;

let memoryToken = null;

const STATIONS = [
  { stationId: "0990", nameZh: "南港", nameEn: "Nangang" },
  { stationId: "1000", nameZh: "台北", nameEn: "Taipei" },
  { stationId: "1010", nameZh: "板橋", nameEn: "Banqiao" },
  { stationId: "1020", nameZh: "桃園", nameEn: "Taoyuan" },
  { stationId: "1030", nameZh: "新竹", nameEn: "Hsinchu" },
  { stationId: "1040", nameZh: "苗栗", nameEn: "Miaoli" },
  { stationId: "1050", nameZh: "台中", nameEn: "Taichung" },
  { stationId: "1060", nameZh: "彰化", nameEn: "Changhua" },
  { stationId: "1070", nameZh: "雲林", nameEn: "Yunlin" },
  { stationId: "1080", nameZh: "嘉義", nameEn: "Chiayi" },
  { stationId: "1090", nameZh: "台南", nameEn: "Tainan" },
  { stationId: "1100", nameZh: "左營", nameEn: "Zuoying" },
];

const NAME_TO_ID = {};
for (const s of STATIONS) {
  NAME_TO_ID[s.nameZh] = s.stationId;
  NAME_TO_ID[s.nameEn.toLowerCase()] = s.stationId;
  NAME_TO_ID[s.stationId] = s.stationId;
}
NAME_TO_ID["臺北"] = "1000";
NAME_TO_ID["台北站"] = "1000";
NAME_TO_ID["高鐵台北"] = "1000";
NAME_TO_ID["臺中"] = "1050";
NAME_TO_ID["臺南"] = "1090";
NAME_TO_ID["高雄"] = "1100";
NAME_TO_ID["左營站"] = "1100";
NAME_TO_ID["高鐵左營"] = "1100";
NAME_TO_ID["新左營"] = "1100";

function tmpPath(name) {
  return path.join(os.tmpdir(), `nexora-thsr-${name}.json`);
}
function readCache(name, ttlMs) {
  try {
    const raw = JSON.parse(fs.readFileSync(tmpPath(name), "utf-8"));
    if (raw && raw.fetchedAt && Date.now() - raw.fetchedAt < ttlMs) return raw.data;
  } catch {
    /* no cache */
  }
  return null;
}
function writeCache(name, data) {
  try {
    fs.writeFileSync(tmpPath(name), JSON.stringify({ data, fetchedAt: Date.now() }), "utf-8");
  } catch {
    /* ignore */
  }
}

function getCredentials() {
  const clientId = process.env.TDX_CLIENT_ID || "";
  const clientSecret = process.env.TDX_CLIENT_SECRET || "";
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

async function getAccessToken() {
  const { clientId, clientSecret, configured } = getCredentials();
  if (!configured) {
    return { ok: false, reason: "tdx-not-configured", hint: "請在 Vercel 設定 TDX_CLIENT_ID、TDX_CLIENT_SECRET" };
  }
  if (memoryToken && memoryToken.expiresAt > Date.now() + TOKEN_SKEW_MS) {
    return { ok: true, token: memoryToken.access_token };
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return { ok: false, reason: "tdx-token-failed", detail: String(t).slice(0, 200) };
  }
  const json = await resp.json();
  const expiresIn = Number(json.expires_in) || 3600;
  memoryToken = {
    access_token: json.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return { ok: true, token: memoryToken.access_token };
}

async function tdxGet(apiPath, query) {
  const tok = await getAccessToken();
  if (!tok.ok) return tok;
  const q = query ? (apiPath.includes("?") ? "&" : "?") + query : "";
  const url = `${API_BASE}${apiPath}${q}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${tok.token}`,
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return { ok: false, reason: "tdx-http", status: resp.status, detail: String(t).slice(0, 300) };
  }
  return { ok: true, data: await resp.json() };
}

function zhName(obj) {
  if (!obj) return null;
  if (typeof obj === "string") return obj;
  return obj.Zh_tw || obj.Zh || obj.En || null;
}

function resolveStationId(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (NAME_TO_ID[s]) return NAME_TO_ID[s];
  if (NAME_TO_ID[s.toLowerCase()]) return NAME_TO_ID[s.toLowerCase()];
  if (/^\d{4}$/.test(s)) return s;
  const stripped = s.replace(/^高鐵/, "").replace(/站$/, "");
  if (NAME_TO_ID[stripped]) return NAME_TO_ID[stripped];
  return null;
}

function todayYmd() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

const STATION_COORDS = {
  "0990": { lat: 25.0522, lon: 121.6066 },
  "1000": { lat: 25.0478, lon: 121.517 },
  "1010": { lat: 25.0138, lon: 121.4648 },
  "1020": { lat: 25.013, lon: 121.215 },
  "1030": { lat: 24.8084, lon: 121.0403 },
  "1040": { lat: 24.6056, lon: 120.825 },
  "1050": { lat: 24.112, lon: 120.616 },
  "1060": { lat: 24.015, lon: 120.541 },
  "1070": { lat: 23.7363, lon: 120.4165 },
  "1080": { lat: 23.4595, lon: 120.323 },
  "1090": { lat: 22.9246, lon: 120.2857 },
  "1100": { lat: 22.687, lon: 120.3075 },
};

function withCoords(s) {
  const c = STATION_COORDS[s.stationId] || {};
  return {
    ...s,
    lat: s.lat != null ? s.lat : c.lat != null ? c.lat : null,
    lon: s.lon != null ? s.lon : c.lon != null ? c.lon : null,
  };
}

function listStations() {
  return {
    ok: true,
    count: STATIONS.length,
    stations: STATIONS.map((s) => withCoords(s)),
  };
}

async function listStationsLive() {
  const cacheKey = "stations-live";
  const cached = readCache(cacheKey, CACHE_TTL_STATIC_MS);
  if (cached) return { ok: true, cached: true, ...cached };
  const res = await tdxGet("/Station", "$format=JSON");
  if (!res.ok) {
    const base = listStations();
    return { ...base, source: "static-fallback", tdxError: res.reason };
  }
  const list = Array.isArray(res.data) ? res.data : [];
  const stations = list.map((row) => {
    const id = String(row.StationID || "");
    const pos = row.StationPosition || {};
    return withCoords({
      stationId: id,
      nameZh: zhName(row.StationName) || id,
      nameEn: (row.StationName && row.StationName.En) || null,
      lat: pos.PositionLat != null ? Number(pos.PositionLat) : null,
      lon: pos.PositionLon != null ? Number(pos.PositionLon) : null,
      address: row.StationAddress || null,
    });
  });
  const final = stations.length ? stations : STATIONS.map((s) => withCoords(s));
  const payload = {
    count: final.length,
    stations: final,
    source: stations.length ? "tdx" : "static",
    updatedAt: new Date().toISOString(),
  };
  writeCache(cacheKey, payload);
  return { ok: true, cached: false, ...payload };
}

async function listShape() {
  const cacheKey = "shape";
  const cached = readCache(cacheKey, CACHE_TTL_STATIC_MS);
  if (cached) return { ok: true, cached: true, ...cached };
  const ordered = ["0990", "1000", "1010", "1020", "1030", "1040", "1050", "1060", "1070", "1080", "1090", "1100"];
  const mapPolyline = {
    stationIds: ordered,
    orderedStops: ordered.map((id) => {
      const s = STATIONS.find((x) => x.stationId === id) || { stationId: id };
      return withCoords(s);
    }),
  };
  const res = await tdxGet("/Shape", "$format=JSON");
  if (!res.ok) {
    const coords = ordered
      .map((id) => {
        const c = STATION_COORDS[id];
        return c ? `${c.lon} ${c.lat}` : null;
      })
      .filter(Boolean);
    const geometry = coords.length ? `LINESTRING(${coords.join(", ")})` : null;
    return {
      ok: true,
      source: "station-sequence-fallback",
      lines: [{ lineKey: "THSR", nameZh: "臺灣高鐵", geometry }],
      mapPolyline,
    };
  }
  const list = Array.isArray(res.data) ? res.data : [];
  const geoms = [];
  for (const row of list) {
    if (row.Geometry) geoms.push(String(row.Geometry));
  }
  const geometry = geoms.length ? geoms.join(";") : null;
  const payload = {
    source: "tdx-shape",
    lines: [{ lineKey: "THSR", nameZh: "臺灣高鐵", geometry }],
    mapPolyline,
    updatedAt: new Date().toISOString(),
  };
  writeCache(cacheKey, payload);
  return { ok: true, cached: false, ...payload };
}

async function odTimetable({ origin, destination, date } = {}) {
  const originId = resolveStationId(origin);
  const destId = resolveStationId(destination);
  if (!originId || !destId) {
    return {
      ok: false,
      reason: "missing-stations",
      hint: "請帶 origin 與 destination（站名或站碼，如 1000／台北、1100／左營）",
    };
  }
  const trainDate = date || todayYmd();
  const cacheKey = `tt-${originId}-${destId}-${trainDate}`;
  const cached = readCache(cacheKey, CACHE_TTL_LIVE_MS);
  if (cached && Array.isArray(cached.trains) && cached.trains.length) {
    return { ok: true, cached: true, ...cached };
  }

  const apiPath = `/DailyTimetable/OD/${encodeURIComponent(originId)}/to/${encodeURIComponent(destId)}/${encodeURIComponent(trainDate)}`;
  const res = await tdxGet(apiPath, "$format=JSON&$top=300");
  if (!res.ok) return res;
  const list = Array.isArray(res.data) ? res.data : [];
  const trains = list.map((row) => {
    const info = row.DailyTrainInfo || {};
    const stops = row.StopTimes || [];
    const originStop = stops.find((x) => String(x.StationID) === originId) || stops[0];
    const destStop = stops.find((x) => String(x.StationID) === destId) || stops[stops.length - 1];
    return {
      trainNo: info.TrainNo || row.TrainNo,
      direction: info.Direction != null ? Number(info.Direction) : null,
      startingStationName: zhName(info.StartingStationName),
      endingStationName: zhName(info.EndingStationName),
      departureTime: originStop && (originStop.DepartureTime || originStop.ArrivalTime),
      arrivalTime: destStop && (destStop.ArrivalTime || destStop.DepartureTime),
      stopCount: stops.length,
    };
  });
  trains.sort((a, b) => String(a.departureTime || "").localeCompare(String(b.departureTime || "")));
  const payload = {
    originStationId: originId,
    destinationStationId: destId,
    originName: (STATIONS.find((s) => s.stationId === originId) || {}).nameZh,
    destinationName: (STATIONS.find((s) => s.stationId === destId) || {}).nameZh,
    date: trainDate,
    count: trains.length,
    trains,
    updatedAt: new Date().toISOString(),
  };
  if (trains.length) writeCache(cacheKey, payload);
  return { ok: true, cached: false, ...payload };
}

async function stationTimetable({ stationId, date } = {}) {
  const sid = resolveStationId(stationId);
  if (!sid) {
    return { ok: false, reason: "missing-stationId", hint: "請帶 stationId（如 1100 左營）" };
  }
  const trainDate = date || todayYmd();
  const cacheKey = `stt-${sid}-${trainDate}`;
  const cached = readCache(cacheKey, CACHE_TTL_LIVE_MS);
  if (cached && Array.isArray(cached.trains) && cached.trains.length) {
    return { ok: true, cached: true, ...cached };
  }

  let list = [];
  let source = "station";
  let res = await tdxGet(
    `/DailyTimetable/Station/${encodeURIComponent(sid)}/${encodeURIComponent(trainDate)}`,
    "$format=JSON&$top=500"
  );
  if (res.ok && Array.isArray(res.data) && res.data.length) {
    list = res.data;
  }

  if (!list.length) {
    source = "train-date-filter";
    res = await tdxGet(`/DailyTimetable/TrainDate/${encodeURIComponent(trainDate)}`, "$format=JSON&$top=800");
    if (!res.ok || !Array.isArray(res.data) || !res.data.length) {
      source = "today-filter";
      res = await tdxGet(`/DailyTimetable/Today`, "$format=JSON&$top=800");
    }
    if (res.ok && Array.isArray(res.data)) {
      for (const row of res.data) {
        const stops = row.StopTimes || row.StopTime || [];
        const stop = stops.find((x) => String(x.StationID || x.StationId) === sid);
        if (!stop) continue;
        const info = row.DailyTrainInfo || row.TrainInfo || {};
        list.push({
          TrainNo: info.TrainNo || row.TrainNo,
          Direction: info.Direction != null ? info.Direction : row.Direction,
          DepartureTime: stop.DepartureTime || stop.ArrivalTime,
          ArrivalTime: stop.ArrivalTime || null,
          EndingStationName: info.EndingStationName || row.EndingStationName,
          StartingStationName: info.StartingStationName || row.StartingStationName,
          EndingStationID: info.EndingStationID || row.EndingStationID,
          StartingStationID: info.StartingStationID || row.StartingStationID,
        });
      }
    }
  }

  if (!list.length && res && !res.ok) return res;

  const trains = list
    .map((row) => {
      const info = row.DailyTrainInfo || {};
      return {
        trainNo: row.TrainNo || info.TrainNo || null,
        direction: row.Direction != null ? Number(row.Direction) : info.Direction != null ? Number(info.Direction) : null,
        departureTime: row.DepartureTime || row.ArrivalTime || null,
        arrivalTime: row.ArrivalTime || null,
        endingStationName: zhName(row.EndingStationName) || zhName(info.EndingStationName),
        startingStationName: zhName(row.StartingStationName) || zhName(info.StartingStationName),
        endingStationId: row.EndingStationID || info.EndingStationID || null,
        startingStationId: row.StartingStationID || info.StartingStationID || null,
      };
    })
    .filter((t) => t.departureTime || t.arrivalTime);

  trains.sort((a, b) => String(a.departureTime || "").localeCompare(String(b.departureTime || "")));
  const payload = {
    stationId: sid,
    stationName: (STATIONS.find((s) => s.stationId === sid) || {}).nameZh,
    date: trainDate,
    count: trains.length,
    trains,
    source,
    updatedAt: new Date().toISOString(),
  };
  if (trains.length) writeCache(cacheKey, payload);
  return { ok: true, cached: false, ...payload };
}

async function upcomingFromStation({ stationId, date, limit } = {}) {
  const st = await stationTimetable({ stationId, date });
  if (!st.ok) return st;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const now = `${parts.hour}:${parts.minute}`;
  const nm = String(now).match(/^(\d{1,2}):(\d{2})/);
  const nowMin = nm ? Number(nm[1]) * 60 + Number(nm[2]) : 0;
  const items = (st.trains || [])
    .map((t) => {
      const dep = t.departureTime;
      const m = dep && String(dep).match(/^(\d{1,2}):(\d{2})/);
      const mins = m ? Number(m[1]) * 60 + Number(m[2]) : null;
      return {
        trainNo: t.trainNo,
        departureTime: dep,
        arrivalTime: t.arrivalTime || null,
        destinationName: t.endingStationName || null,
        direction: t.direction,
        estimateMinutes: mins != null ? Math.max(0, mins - nowMin) : null,
        headsign: t.endingStationName ? "往" + t.endingStationName : null,
      };
    })
    .filter((t) => t.estimateMinutes == null || t.estimateMinutes >= 0)
    .sort((a, b) => String(a.departureTime || "").localeCompare(String(b.departureTime || "")))
    .slice(0, Math.min(40, Number(limit) || 12));
  return {
    ok: true,
    stationId: st.stationId || stationId,
    stationName: st.stationName,
    date: st.date,
    now,
    count: items.length,
    items,
    source: st.source,
  };
}

async function availableSeats({ origin, destination, date } = {}) {
  const originId = resolveStationId(origin);
  const destId = resolveStationId(destination);
  if (!originId || !destId) {
    return { ok: false, reason: "missing-stations", hint: "請帶 origin 與 destination" };
  }
  const trainDate = date || todayYmd();
  const cacheKey = `seat-${originId}-${destId}-${trainDate}`;
  const cached = readCache(cacheKey, CACHE_TTL_LIVE_MS);
  if (cached) return { ok: true, cached: true, ...cached };

  let res = await tdxGet(
    `/AvailableSeatStatusList/${encodeURIComponent(originId)}/to/${encodeURIComponent(destId)}/${encodeURIComponent(trainDate)}`,
    "$format=JSON"
  );
  if (!res.ok) {
    res = await tdxGet(
      `/AvailableSeatStatus/Train/OD/${encodeURIComponent(originId)}/to/${encodeURIComponent(destId)}/TrainDate/${encodeURIComponent(trainDate)}`,
      "$format=JSON"
    );
  }
  if (!res.ok) return res;
  const list = Array.isArray(res.data)
    ? res.data
    : res.data && res.data.AvailableSeats
      ? res.data.AvailableSeats
      : [];
  const trains = (Array.isArray(list) ? list : []).map((row) => ({
    trainNo: row.TrainNo,
    direction: row.Direction,
    departureTime: row.DepartureTime,
    standardSeatStatus: row.StandardSeatStatus || row.StationSeatStatus,
    businessSeatStatus: row.BusinessSeatStatus,
  }));
  const payload = {
    originStationId: originId,
    destinationStationId: destId,
    date: trainDate,
    count: trains.length,
    trains,
    updatedAt: new Date().toISOString(),
  };
  writeCache(cacheKey, payload);
  return { ok: true, cached: false, ...payload };
}

async function odFare({ origin, destination } = {}) {
  const originId = resolveStationId(origin);
  const destId = resolveStationId(destination);
  if (!originId || !destId) {
    return { ok: false, reason: "missing-stations" };
  }
  const cacheKey = `fare-${originId}-${destId}`;
  const cached = readCache(cacheKey, CACHE_TTL_STATIC_MS);
  if (cached) return { ok: true, cached: true, ...cached };

  const apiPath = `/ODFare/${encodeURIComponent(originId)}/to/${encodeURIComponent(destId)}`;
  const res = await tdxGet(apiPath, "$format=JSON");
  if (!res.ok) return res;
  const list = Array.isArray(res.data) ? res.data : [];
  const fares = list.map((row) => ({
    originStationId: row.OriginStationID,
    destinationStationId: row.DestinationStationID,
    direction: row.Direction,
    fares: (row.Fares || []).map((f) => ({
      ticketType: f.TicketType,
      price: f.Price,
      fareClass: f.FareClass,
      cabinClass: f.CabinClass,
    })),
  }));
  const payload = {
    originStationId: originId,
    destinationStationId: destId,
    fares,
    updatedAt: new Date().toISOString(),
  };
  writeCache(cacheKey, payload);
  return { ok: true, cached: false, ...payload };
}

async function handleThsrQuery(query) {
  const q = query || {};
  const type = String(q.type || q.action || "summary").toLowerCase();

  if (type === "stations" || type === "list") return listStationsLive();
  if (type === "lines" || type === "shape" || type === "sequence") return listShape();
  if (type === "timetable" || type === "od" || type === "schedule") {
    return odTimetable({
      origin: q.origin || q.from || q.originStationId,
      destination: q.destination || q.to || q.destinationStationId,
      date: q.date || q.trainDate,
    });
  }
  if (type === "station-timetable" || type === "station") {
    return stationTimetable({
      stationId: q.stationId || q.station,
      date: q.date || q.trainDate,
    });
  }
  if (type === "upcoming" || type === "next" || type === "departures") {
    return upcomingFromStation({
      stationId: q.stationId || q.station || q.origin,
      date: q.date || q.trainDate,
      limit: q.limit,
    });
  }
  if (type === "seats" || type === "available" || type === "available-seats") {
    return availableSeats({
      origin: q.origin || q.from,
      destination: q.destination || q.to,
      date: q.date || q.trainDate,
    });
  }
  if (type === "fare" || type === "fares") {
    return odFare({
      origin: q.origin || q.from,
      destination: q.destination || q.to,
    });
  }

  const cred = getCredentials();
  return {
    ok: true,
    tdxConfigured: cred.configured,
    system: "THSR",
    systemName: "臺灣高鐵",
    stations: STATIONS.map((s) => withCoords(s)),
    usage: {
      stations: "?type=stations",
      lines: "?type=lines",
      timetable: "?type=timetable&origin=1000&destination=1100",
      stationTimetable: "?type=station-timetable&stationId=1100",
      upcoming: "?type=upcoming&stationId=1100",
      seats: "?type=seats&origin=台北&destination=左營",
      fare: "?type=fare&origin=1000&destination=1100",
    },
  };
}

module.exports = {
  handleThsrQuery,
  listStations,
  listStationsLive,
  listShape,
  upcomingFromStation,
  odTimetable,
  stationTimetable,
  availableSeats,
  odFare,
  resolveStationId,
  STATIONS,
};
