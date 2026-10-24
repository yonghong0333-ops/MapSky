/**
 * 臺鐵（TRA）— 與高鐵相同策略
 * 優先 api/_data/tra-timetable.json（GitHub 當日快取），再 TDX LiveBoard
 * 已過發車時刻不回傳
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const tdxShared = require("./tdx-shared");

const API_BASE = "https://tdx.transportdata.tw/api/basic/v3/Rail/TRA";
const CACHE_TTL_STATIC_MS = 6 * 60 * 60 * 1000;
const CACHE_TTL_LIVE_MS = 60 * 1000;

function loadBundledTraCache() {
  try {
    const p = path.join(__dirname, "..", "_data", "tra-timetable.json");
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (!raw || !raw.stations) return null;
    return raw;
  } catch {
    return null;
  }
}

function upcomingFromBundle(stationId, limit) {
  const bundle = loadBundledTraCache();
  if (!bundle) return null;
  const sid = String(stationId).trim();
  const block = bundle.stations[sid];
  if (!block || !Array.isArray(block.trains) || !block.trains.length) return null;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const now = `${parts.hour}:${parts.minute}`;
  const nm = now.match(/^(\d{1,2}):(\d{2})/);
  const nowMin = nm ? Number(nm[1]) * 60 + Number(nm[2]) : 0;
  const items = block.trains
    .map((t) => {
      const m = t.departureTime && String(t.departureTime).match(/^(\d{1,2}):(\d{2})/);
      const mins = m ? Number(m[1]) * 60 + Number(m[2]) : null;
      const estimateMinutes = mins != null ? mins - nowMin : null;
      return {
        trainNo: t.trainNo,
        trainType: t.trainType,
        direction: t.direction,
        departureTime: t.departureTime,
        destinationName: t.destinationName,
        endingStationName: t.destinationName,
        startingStationName: t.startingStationName,
        estimateMinutes,
        headsign: t.destinationName ? "往" + t.destinationName : null,
        statusLabel:
          estimateMinutes == null
            ? null
            : estimateMinutes <= 0
              ? "即將發車"
              : `${estimateMinutes} 分鐘`,
        delayMinutes: 0,
      };
    })
    .filter((t) => t.estimateMinutes == null || t.estimateMinutes >= 0)
    .slice(0, Math.min(40, Number(limit) || 20));
  return {
    ok: true,
    cached: true,
    source: "github-cache",
    stationId: sid,
    date: bundle.date,
    count: items.length,
    items,
    trains: items,
    updatedAt: bundle.updatedAt,
    note: "使用 GitHub 當日時刻表快取",
  };
}

function tmpPath(name) {
  return path.join(os.tmpdir(), `nexora-tra-${name}.json`);
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
function mapLiveBoard(row) {
  return {
    trainNo: row.TrainNo || null,
    trainType: zhName(row.TrainTypeName) || row.TrainType || null,
    stationId: row.StationID || null,
    stationName: zhName(row.StationName),
    direction: row.Direction != null ? Number(row.Direction) : null,
    endingStationName: zhName(row.EndingStationName),
    scheduledTime: row.ScheduleTime || row.ScheduledDepartureTime || null,
    arrivalTime: row.EstimatedArrivalTime || row.ArrivalTime || null,
    departureTime: row.EstimatedDepartureTime || row.DepartureTime || row.ScheduleTime || null,
    delayMinutes: row.DelayTime != null ? Number(row.DelayTime) : 0,
    platform: row.Platform || row.PlatformID || null,
  };
}
async function listStations({ q, city } = {}) {
  const cacheKey = "stations";
  const cached = readCache(cacheKey, CACHE_TTL_STATIC_MS);
  let list = cached;
  if (!list) {
    const res = await tdxGet("/Station", "$format=JSON&$top=500");
    if (!res.ok) return res;
    list = Array.isArray(res.data) ? res.data : [];
    writeCache(cacheKey, list);
  }
  let stations = list.map((s) => ({
    stationId: s.StationID,
    nameZh: zhName(s.StationName),
    nameEn: (s.StationName && s.StationName.En) || null,
    lat: s.StationPosition && (s.StationPosition.PositionLat || s.StationPosition.lat),
    lon: s.StationPosition && (s.StationPosition.PositionLon || s.StationPosition.lon),
  }));
  if (q) {
    const k = String(q).toLowerCase();
    stations = stations.filter(
      (s) =>
        (s.nameZh && s.nameZh.includes(q)) ||
        (s.nameEn && s.nameEn.toLowerCase().includes(k)) ||
        String(s.stationId).includes(q)
    );
  }
  return { ok: true, count: stations.length, stations };
}
async function listLines() {
  const cacheKey = "lines";
  const cached = readCache(cacheKey, CACHE_TTL_STATIC_MS);
  if (cached) return { ok: true, cached: true, lines: cached };
  const res = await tdxGet("/Line", "$format=JSON&$top=100");
  if (!res.ok) return res;
  const list = Array.isArray(res.data) ? res.data : [];
  const lines = list.map((L) => ({
    lineId: L.LineID,
    nameZh: zhName(L.LineName),
    isBranch: Boolean(L.IsBranch),
  }));
  writeCache(cacheKey, lines);
  return { ok: true, cached: false, lines };
}
async function stationLiveBoard({ stationId } = {}) {
  if (!stationId) {
    return { ok: false, reason: "missing-stationId", hint: "請帶 stationId，例如 4400（高雄）" };
  }
  const sid = String(stationId).trim();
  const cacheKey = `live-${sid}`;
  const cached = readCache(cacheKey, CACHE_TTL_LIVE_MS);
  if (cached && cached.items && cached.items.length) {
    return { ok: true, cached: true, stationId: sid, ...cached };
  }
  const bundledFirst = upcomingFromBundle(sid, 20);
  if (bundledFirst && bundledFirst.count) return bundledFirst;

  const stale = tdxShared.readCache("tra", cacheKey, 0, { allowStaleMs: 10 * 60 * 1000 });
  let res = await tdxGet(`/StationLiveBoard/Station/${encodeURIComponent(sid)}`, "$format=JSON&$top=50");
  if (!res.ok && res.reason !== "tdx-rate-limit") {
    res = await tdxGet(
      "/StationLiveBoard",
      `$format=JSON&$top=300&$filter=StationID eq '${sid.replace(/'/g, "")}'`
    );
  }
  if (!res.ok) {
    if (stale && stale.data) {
      return {
        ok: true,
        cached: true,
        stale: true,
        stationId: sid,
        ...stale.data,
        note: res.reason === "tdx-rate-limit" ? "TDX 限流中，顯示稍早資料" : "上游失敗，顯示稍早資料",
        upstreamReason: res.reason,
      };
    }
    return res;
  }
  const raw = res.data;
  const list = Array.isArray(raw)
    ? raw
    : raw.StationLiveBoards || raw.StationLiveBoard || raw.TrainLiveBoards || [];
  const items = list.map(mapLiveBoard);
  items.sort((a, b) => {
    const ta = a.departureTime || a.arrivalTime || a.scheduledTime || "";
    const tb = b.departureTime || b.arrivalTime || b.scheduledTime || "";
    return String(ta).localeCompare(String(tb));
  });
  if (!items.length) {
    const bundled = upcomingFromBundle(sid, 20);
    if (bundled && bundled.count) return bundled;
  }
  const payload = { count: items.length, items, updatedAt: new Date().toISOString() };
  writeCache(cacheKey, payload);
  try {
    tdxShared.writeCache("tra", cacheKey, payload);
  } catch (_) {}
  return { ok: true, cached: false, stationId: sid, ...payload };
}
async function trainLiveBoard({ trainNo } = {}) {
  const cacheKey = `train-${trainNo || "all"}`;
  const cached = readCache(cacheKey, CACHE_TTL_LIVE_MS);
  if (cached) return { ok: true, cached: true, ...cached };
  let pathApi = "/TrainLiveBoard";
  let query = "$format=JSON&$top=100";
  if (trainNo) pathApi = `/TrainLiveBoard/TrainNo/${encodeURIComponent(String(trainNo).trim())}`;
  const res = await tdxGet(pathApi, query);
  if (!res.ok) return res;
  const raw = res.data;
  const list = Array.isArray(raw) ? raw : raw.TrainLiveBoards || raw.TrainLiveBoard || [];
  const payload = { count: list.length, trains: list, updatedAt: new Date().toISOString() };
  writeCache(cacheKey, payload);
  return { ok: true, cached: false, ...payload };
}
async function alerts() {
  const res = await tdxGet("/Alert", "$format=JSON&$top=50");
  if (!res.ok) return res;
  const raw = res.data;
  const list = Array.isArray(raw) ? raw : raw.Alerts || [];
  return { ok: true, count: list.length, alerts: list };
}
async function handleTraQuery(query) {
  const q = query || {};
  const type = String(q.type || q.action || "summary").toLowerCase();
  if (type === "stations" || type === "list") {
    return listStations({ q: q.q || q.keyword || q.name, city: q.city });
  }
  if (type === "lines") return listLines();
  if (["timetable", "station-timetable", "upcoming", "next", "departures", "live", "liveboard", "board"].includes(type)) {
    const sid = q.stationId || q.station || null;
    if (["timetable", "station-timetable", "upcoming", "next", "departures"].includes(type)) {
      const bundled = sid ? upcomingFromBundle(sid, q.limit) : null;
      if (bundled && bundled.count) return bundled;
    }
    return stationLiveBoard({ stationId: sid });
  }
  if (type === "train" || type === "train-live") {
    return trainLiveBoard({ trainNo: q.trainNo || q.train || null });
  }
  if (type === "alert" || type === "alerts") return alerts();
  const cred = getCredentials();
  return {
    ok: true,
    tdxConfigured: cred.configured,
    system: "TRA",
    systemName: "臺灣鐵路",
    usage: {
      stations: "?type=stations&q=新左營",
      live: "?type=live&stationId=3340",
      timetable: "?type=timetable&stationId=3340",
      lines: "?type=lines",
      alerts: "?type=alerts",
    },
  };
}
module.exports = {
  handleTraQuery,
  listStations,
  listLines,
  stationLiveBoard,
  trainLiveBoard,
  alerts,
  getCredentials,
};
