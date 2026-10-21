/**
 * 臺鐵（TRA）— TDX v3
 * 環境變數同捷運：TDX_CLIENT_ID、TDX_CLIENT_SECRET
 *
 * 常用站碼（v3）：1000 臺北、1080 桃園、1100 新竹、3300 臺中、4400 高雄、4340 新左營、4220 臺南
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const TOKEN_URL =
  "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const API_BASE = "https://tdx.transportdata.tw/api/basic/v3/Rail/TRA";

const CACHE_TTL_STATIC_MS = 6 * 60 * 60 * 1000;
const CACHE_TTL_LIVE_MS = 60 * 1000;
const TOKEN_SKEW_MS = 60 * 1000;

let memoryToken = null;

function tmpPath(name) {
  return path.join(os.tmpdir(), `nexora-tra-${name}.json`);
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

const tdxShared = require("./tdx-shared");

function getCredentials() {
  return tdxShared.getCredentials();
}

async function getAccessToken() {
  return tdxShared.getAccessToken();
}

async function tdxGet(apiPath, query) {
  return tdxShared.tdxGet(API_BASE, apiPath, query);
}

function zhName(obj) {
  if (!obj) return null;
  if (typeof obj === "string") return obj;
  return obj.Zh_tw || obj.Zh || obj.En || null;
}

function mapStation(s) {
  const id = s.StationID || s.StationId;
  return {
    stationId: id,
    stationCode: s.StationCode || null,
    nameZh: zhName(s.StationName) || id,
    nameEn: (s.StationName && s.StationName.En) || null,
    lat: s.StationPosition && (s.StationPosition.PositionLat || s.StationPosition.lat),
    lon: s.StationPosition && (s.StationPosition.PositionLon || s.StationPosition.lon),
    address: s.StationAddress || null,
    stationClass: s.StationClass != null ? String(s.StationClass) : null,
  };
}

function mapLiveBoard(row) {
  const delay = row.DelayTime != null ? Number(row.DelayTime) : null;
  return {
    stationId: row.StationID,
    stationName: zhName(row.StationName),
    trainNo: row.TrainNo || null,
    trainTypeCode: row.TrainTypeCode || null,
    trainTypeName: zhName(row.TrainTypeName) || row.TrainTypeCode || null,
    direction: row.Direction != null ? Number(row.Direction) : null,
    endingStationId: row.EndingStationID || null,
    endingStationName: zhName(row.EndingStationName),
    tripLine: row.TripLine != null ? Number(row.TripLine) : null,
    scheduledTime: row.ScheduleArrivalTime || row.ScheduleDepartureTime || null,
    arrivalTime: row.ArrivalTime || null,
    departureTime: row.DepartureTime || null,
    delayMinutes: delay,
    status: delay == null ? null : delay <= 0 ? "準點" : delay < 5 ? "小誤點" : "誤點",
    platform: row.PlatformID || row.PlatformNo || null,
    srcUpdateTime: row.UpdateTime || row.SrcUpdateTime || null,
  };
}

async function listStations({ q = null, city = null } = {}) {
  const cacheKey = "stations";
  let list = readCache(cacheKey, CACHE_TTL_STATIC_MS);
  let cached = Boolean(list);
  if (!list) {
    const res = await tdxGet("/Station", "$format=JSON&$top=500");
    if (!res.ok) return res;
    const raw = res.data;
    list = Array.isArray(raw) ? raw : raw.Stations || raw.Station || [];
    writeCache(cacheKey, list);
    cached = false;
  }
  let stations = list.map(mapStation);
  if (q) {
    const needle = String(q).trim().toLowerCase();
    stations = stations.filter(
      (s) =>
        String(s.nameZh || "").toLowerCase().includes(needle) ||
        String(s.nameEn || "").toLowerCase().includes(needle) ||
        String(s.stationId || "") === needle ||
        String(s.stationCode || "").toLowerCase() === needle
    );
  }
  if (city) {
    const c = String(city).replace(/台/g, "臺");
    stations = stations.filter((s) => String(s.address || "").includes(c) || String(s.nameZh || "").includes(c));
  }
  stations.sort((a, b) => String(a.stationId).localeCompare(String(b.stationId)));
  return { ok: true, cached, count: stations.length, stations };
}

async function listLines() {
  const cacheKey = "lines";
  const cached = readCache(cacheKey, CACHE_TTL_STATIC_MS);
  if (cached) return { ok: true, cached: true, lines: cached };
  const res = await tdxGet("/Line", "$format=JSON&$top=100");
  if (!res.ok) return res;
  const raw = res.data;
  const list = Array.isArray(raw) ? raw : raw.Lines || raw.Line || [];
  const lines = list.map((L) => ({
    lineId: L.LineID || L.LineId,
    nameZh: zhName(L.LineName) || L.LineID,
    nameEn: (L.LineName && L.LineName.En) || null,
    lineSectionName: zhName(L.LineSectionName),
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
  if (cached) return { ok: true, cached: true, stationId: sid, ...cached };

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
  const payload = {
    count: items.length,
    items,
    updatedAt: new Date().toISOString(),
  };
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
  if (trainNo) {
    pathApi = `/TrainLiveBoard/TrainNo/${encodeURIComponent(String(trainNo).trim())}`;
  }
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
  if (type === "live" || type === "liveboard" || type === "board") {
    return stationLiveBoard({ stationId: q.stationId || q.station || null });
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
      live: "?type=live&stationId=4340",
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
