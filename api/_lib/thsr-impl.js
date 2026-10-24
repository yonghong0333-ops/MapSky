/**
 * 臺灣高鐵（THSR）— TDX v2
 * 優先讀 api/_data/thsr-timetable.json（GitHub Actions 統一刷新）
 * 已過發車時刻的班次不會回傳
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const tdxShared = require("./tdx-shared");

function loadBundledThsrCache() {
  try {
    const p = path.join(__dirname, "..", "_data", "thsr-timetable.json");
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (!raw || !raw.stations) return null;
    return raw;
  } catch {
    return null;
  }
}

function trainsFromBundle(sid, date) {
  const bundle = loadBundledThsrCache();
  if (!bundle) return null;
  const block = bundle.stations && bundle.stations[String(sid)];
  if (!block || !Array.isArray(block.trains) || !block.trains.length) return null;
  return {
    trains: block.trains,
    date: bundle.date || date,
    updatedAt: bundle.updatedAt,
    source: "github-cache",
    stale: !!(bundle.date && date && bundle.date !== date),
  };
}

const API_BASE = "https://tdx.transportdata.tw/api/basic/v2/Rail/THSR";
const CACHE_TTL_STATIC_MS = 12 * 60 * 60 * 1000;
const CACHE_TTL_LIVE_MS = 5 * 60 * 1000;
const CACHE_TTL_STATION_MS = 45 * 60 * 1000;

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
NAME_TO_ID["高雄"] = "1100";
NAME_TO_ID["左營站"] = "1100";
NAME_TO_ID["高鐵左營"] = "1100";
NAME_TO_ID["新左營"] = "1100";
NAME_TO_ID["臺中"] = "1050";
NAME_TO_ID["臺南"] = "1090";

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

function tmpPath(name) {
  return path.join(os.tmpdir(), `nexora-thsr-${name}.json`);
}
function readCache(name, ttlMs) {
  try {
    const raw = JSON.parse(fs.readFileSync(tmpPath(name), "utf-8"));
    if (raw && raw.fetchedAt && Date.now() - raw.fetchedAt < ttlMs) return raw.data;
  } catch {}
  return null;
}
function writeCache(name, data) {
  try {
    fs.writeFileSync(tmpPath(name), JSON.stringify({ data, fetchedAt: Date.now() }), "utf-8");
  } catch {}
}
function getCredentials() {
  return tdxShared.getCredentials();
}
async function tdxGet(apiPath, query) {
  return tdxShared.tdxGet(API_BASE, apiPath, query);
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
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function withCoords(s) {
  const c = STATION_COORDS[s.stationId] || {};
  return {
    ...s,
    lat: s.lat != null ? s.lat : c.lat != null ? c.lat : null,
    lon: s.lon != null ? s.lon : c.lon != null ? c.lon : null,
  };
}
function listStations() {
  return { ok: true, count: STATIONS.length, stations: STATIONS.map((s) => withCoords(s)) };
}
async function listStationsLive() {
  const cacheKey = "stations-live";
  const cached = readCache(cacheKey, CACHE_TTL_STATIC_MS);
  if (cached) return { ok: true, cached: true, ...cached };
  const res = await tdxGet("/Station", "$format=JSON");
  if (!res.ok) return { ...listStations(), source: "static-fallback", tdxError: res.reason };
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
  const payload = { count: final.length, stations: final, source: stations.length ? "tdx" : "static", updatedAt: new Date().toISOString() };
  writeCache(cacheKey, payload);
  return { ok: true, cached: false, ...payload };
}
async function listShape() {
  const ordered = ["0990", "1000", "1010", "1020", "1030", "1040", "1050", "1060", "1070", "1080", "1090", "1100"];
  const mapPolyline = {
    stationIds: ordered,
    orderedStops: ordered.map((id) => withCoords(STATIONS.find((x) => x.stationId === id) || { stationId: id })),
  };
  const res = await tdxGet("/Shape", "$format=JSON");
  if (!res.ok) {
    const coords = ordered.map((id) => STATION_COORDS[id]).filter(Boolean).map((c) => `${c.lon} ${c.lat}`);
    return {
      ok: true,
      source: "station-sequence-fallback",
      lines: [{ lineKey: "THSR", nameZh: "臺灣高鐵", geometry: coords.length ? `LINESTRING(${coords.join(", ")})` : null }],
      mapPolyline,
    };
  }
  const list = Array.isArray(res.data) ? res.data : [];
  const geoms = list.filter((r) => r.Geometry).map((r) => String(r.Geometry));
  return {
    ok: true,
    source: "tdx-shape",
    lines: [{ lineKey: "THSR", nameZh: "臺灣高鐵", geometry: geoms.length ? geoms.join(";") : null }],
    mapPolyline,
    updatedAt: new Date().toISOString(),
  };
}
async function odTimetable({ origin, destination, date } = {}) {
  const originId = resolveStationId(origin);
  const destId = resolveStationId(destination);
  if (!originId || !destId) return { ok: false, reason: "missing-stations", hint: "請帶 origin 與 destination" };
  const trainDate = date || todayYmd();
  const cacheKey = `tt-${originId}-${destId}-${trainDate}`;
  const cached = readCache(cacheKey, CACHE_TTL_LIVE_MS);
  if (cached && cached.trains && cached.trains.length) return { ok: true, cached: true, ...cached };
  const res = await tdxGet(
    `/DailyTimetable/OD/${encodeURIComponent(originId)}/to/${encodeURIComponent(destId)}/${encodeURIComponent(trainDate)}`,
    "$format=JSON&$top=300"
  );
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
  if (!sid) return { ok: false, reason: "missing-stationId", hint: "請帶 stationId（如 1100 左營）" };
  const trainDate = date || todayYmd();
  const cacheKey = `stt-${sid}-${trainDate}`;
  const cached = readCache(cacheKey, CACHE_TTL_STATION_MS);
  if (cached && cached.trains && cached.trains.length) return { ok: true, cached: true, ...cached };

  const bundled = trainsFromBundle(sid, trainDate);
  if (bundled && bundled.trains.length) {
    const payload = {
      stationId: sid,
      stationName: (STATIONS.find((x) => x.stationId === sid) || {}).nameZh,
      date: bundled.date || trainDate,
      count: bundled.trains.length,
      trains: bundled.trains,
      source: bundled.source,
      updatedAt: bundled.updatedAt || new Date().toISOString(),
      stale: !!bundled.stale,
      note: bundled.stale ? "使用 GitHub 快取班表（日期可能非今日）" : "使用 GitHub 快取班表",
    };
    writeCache(cacheKey, payload);
    return { ok: true, cached: true, ...payload };
  }

  try {
    const shared = await tdxShared.readCacheAsync("thsr", cacheKey, CACHE_TTL_STATION_MS, {
      allowStaleMs: 12 * 60 * 60 * 1000,
    });
    if (shared && shared.data && shared.data.trains && shared.data.trains.length) {
      writeCache(cacheKey, shared.data);
      return { ok: true, cached: true, stale: !!shared.stale, ...shared.data, note: shared.stale ? "使用快取班表" : undefined };
    }
  } catch (_) {}

  function pushFromStationRow(row, into) {
    const info = row.DailyTrainInfo || {};
    const dep = row.DepartureTime || row.departureTime || null;
    const arr = row.ArrivalTime || row.arrivalTime || null;
    const trainNo = row.TrainNo || info.TrainNo || row.trainNo || null;
    if (!trainNo && !dep) return;
    into.push({
      trainNo,
      direction: row.Direction != null ? Number(row.Direction) : info.Direction != null ? Number(info.Direction) : null,
      departureTime: dep,
      arrivalTime: arr,
      endingStationName: zhName(row.EndingStationName) || zhName(info.EndingStationName),
      startingStationName: zhName(row.StartingStationName) || zhName(info.StartingStationName),
    });
  }
  function extractList(res) {
    if (!res || !res.ok) return [];
    const d = res.data;
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.TrainTimetables)) return d.TrainTimetables;
    if (d && Array.isArray(d.StationTimetables)) return d.StationTimetables;
    return [];
  }

  let list = [];
  let source = "station";
  let lastRes = await tdxGet(
    `/DailyTimetable/Station/${encodeURIComponent(sid)}/${encodeURIComponent(trainDate)}`,
    "$format=JSON&$top=500"
  );
  list = extractList(lastRes);
  if (!list.length && lastRes && lastRes.reason === "tdx-rate-limit") {
    return { ...lastRes, stationId: sid, date: trainDate };
  }
  if (!list.length) {
    source = "today";
    lastRes = await tdxGet(`/DailyTimetable/Today`, "$format=JSON&$top=500");
    if (lastRes && lastRes.reason === "tdx-rate-limit") return { ...lastRes, stationId: sid, date: trainDate };
    for (const row of extractList(lastRes)) {
      const stops = row.StopTimes || [];
      const stop = stops.find((x) => String(x.StationID || x.StationId || "") === String(sid));
      if (!stop) continue;
      const info = row.DailyTrainInfo || {};
      list.push({
        TrainNo: info.TrainNo || row.TrainNo,
        Direction: info.Direction != null ? info.Direction : row.Direction,
        DepartureTime: stop.DepartureTime || stop.ArrivalTime,
        ArrivalTime: stop.ArrivalTime || null,
        EndingStationName: info.EndingStationName,
        StartingStationName: info.StartingStationName,
        DailyTrainInfo: info,
      });
    }
  }
  if (!list.length) {
    source = "od-north";
    for (const dest of ["1000", "0990", "1050"]) {
      if (dest === sid) continue;
      lastRes = await tdxGet(
        `/DailyTimetable/OD/${encodeURIComponent(sid)}/to/${encodeURIComponent(dest)}/${encodeURIComponent(trainDate)}`,
        "$format=JSON&$top=300"
      );
      if (lastRes && lastRes.reason === "tdx-rate-limit") break;
      for (const row of extractList(lastRes)) {
        const info = row.DailyTrainInfo || {};
        const stops = row.StopTimes || [];
        const originStop = stops.find((x) => String(x.StationID) === String(sid)) || stops[0];
        list.push({
          TrainNo: info.TrainNo || row.TrainNo,
          Direction: info.Direction != null ? info.Direction : 1,
          DepartureTime: originStop && (originStop.DepartureTime || originStop.ArrivalTime),
          ArrivalTime: originStop && originStop.ArrivalTime,
          EndingStationName: info.EndingStationName,
          StartingStationName: info.StartingStationName,
          DailyTrainInfo: info,
        });
      }
      if (list.length) break;
    }
  }
  if (!list.length && lastRes && !lastRes.ok) {
    return { ...lastRes, stationId: sid, stationName: (STATIONS.find((x) => x.stationId === sid) || {}).nameZh, date: trainDate };
  }
  const trains = [];
  for (const row of list) pushFromStationRow(row, trains);
  const seen = new Set();
  const unique = trains.filter((t) => {
    const k = `${t.trainNo}|${t.departureTime}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return Boolean(t.departureTime || t.arrivalTime);
  });
  unique.sort((a, b) => String(a.departureTime || "").localeCompare(String(b.departureTime || "")));
  const payload = {
    stationId: sid,
    stationName: (STATIONS.find((x) => x.stationId === sid) || {}).nameZh,
    date: trainDate,
    count: unique.length,
    trains: unique,
    source,
    updatedAt: new Date().toISOString(),
  };
  if (unique.length) {
    writeCache(cacheKey, payload);
    try {
      tdxShared.writeCache("thsr", cacheKey, payload);
      await tdxShared.writeCacheAsync("thsr", cacheKey, payload, 8 * 3600);
    } catch (_) {}
  }
  return { ok: true, cached: false, ...payload };
}
async function upcomingFromStation({ stationId, date, limit } = {}) {
  const st = await stationTimetable({ stationId, date });
  if (!st.ok) return st;
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false });
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
        destinationName: t.endingStationName || null,
        direction: t.direction,
        _delta: mins != null ? mins - nowMin : null,
        headsign: t.endingStationName ? "往" + t.endingStationName : null,
      };
    })
    .filter((t) => t._delta == null || t._delta >= 0)
    .map((t) => {
      const { _delta, ...rest } = t;
      return { ...rest, estimateMinutes: _delta != null ? _delta : null };
    })
    .sort((a, b) => String(a.departureTime || "").localeCompare(String(b.departureTime || "")))
    .slice(0, Math.min(40, Number(limit) || 12));
  const enriched = items.map((t) => {
    const em = t.estimateMinutes;
    const label = em == null ? null : em <= 0 ? "即將發車" : `${em} 分鐘`;
    return { ...t, statusLabel: label, waitText: label };
  });
  return {
    ok: true,
    type: "live",
    stationId: st.stationId || stationId,
    stationName: st.stationName,
    date: st.date,
    now,
    count: enriched.length,
    items: enriched,
    trains: enriched,
    source: st.source,
    cached: st.cached || false,
    note: st.note || (enriched.length ? null : "目前沒有接下來的班次（可能已收班或資料暫缺）"),
  };
}
async function availableSeats({ origin, destination, date } = {}) {
  const originId = resolveStationId(origin);
  const destId = resolveStationId(destination);
  if (!originId || !destId) return { ok: false, reason: "missing-stations" };
  const trainDate = date || todayYmd();
  let res = await tdxGet(
    `/AvailableSeatStatusList/${encodeURIComponent(originId)}/to/${encodeURIComponent(destId)}/${encodeURIComponent(trainDate)}`,
    "$format=JSON"
  );
  if (!res.ok && res.reason !== "tdx-rate-limit") {
    res = await tdxGet(
      `/AvailableSeatStatus/Train/OD/${encodeURIComponent(originId)}/to/${encodeURIComponent(destId)}/TrainDate/${encodeURIComponent(trainDate)}`,
      "$format=JSON"
    );
  }
  if (!res.ok) return res;
  const list = Array.isArray(res.data) ? res.data : (res.data && res.data.AvailableSeats) || [];
  return { ok: true, originStationId: originId, destinationStationId: destId, date: trainDate, count: list.length, trains: list };
}
async function odFare({ origin, destination } = {}) {
  const originId = resolveStationId(origin);
  const destId = resolveStationId(destination);
  if (!originId || !destId) return { ok: false, reason: "missing-stations" };
  const res = await tdxGet(`/ODFare/${encodeURIComponent(originId)}/to/${encodeURIComponent(destId)}`, "$format=JSON");
  if (!res.ok) return res;
  return { ok: true, originStationId: originId, destinationStationId: destId, fares: Array.isArray(res.data) ? res.data : [] };
}
async function handleThsrQuery(query) {
  const q = query || {};
  const type = String(q.type || q.action || "summary").toLowerCase();
  if (type === "stations" || type === "list") return listStationsLive();
  if (type === "lines" || type === "shape" || type === "sequence") return listShape();
  if (["live", "liveboard", "board", "upcoming", "next", "departures"].includes(type)) {
    return upcomingFromStation({ stationId: q.stationId || q.station || q.origin, date: q.date || q.trainDate, limit: q.limit });
  }
  if (type === "timetable" || type === "od" || type === "schedule") {
    const origin = q.origin || q.from || q.originStationId;
    const destination = q.destination || q.to || q.destinationStationId;
    const sid = q.stationId || q.station;
    if ((!origin || !destination) && sid) return stationTimetable({ stationId: sid, date: q.date || q.trainDate });
    return odTimetable({ origin, destination, date: q.date || q.trainDate });
  }
  if (type === "station-timetable" || type === "station") {
    return stationTimetable({ stationId: q.stationId || q.station, date: q.date || q.trainDate });
  }
  if (type === "seats" || type === "available" || type === "available-seats") {
    return availableSeats({ origin: q.origin || q.from, destination: q.destination || q.to, date: q.date });
  }
  if (type === "fare" || type === "fares") {
    return odFare({ origin: q.origin || q.from, destination: q.destination || q.to });
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
      live: "?type=live&stationId=1100",
      timetable: "?type=timetable&stationId=1100",
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
