/**
 * 臺灣高鐵（THSR）— 後台只提供班表
 * live 只讀 api/_data/thsr-timetable.json，不打 TDX（避免 429）；路線與車站由 App 本機繪製
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const tdxShared = require("./tdx-shared");
const timetableStore = require("./timetable-store");

function loadBundledThsrCache() {
  return timetableStore.load("thsr");
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
/** 路線與車站由 App 本機繪製；舊版 App 若還在問，回空清單（不是錯誤） */
function localShape() {
  return {
    ok: true,
    source: "device",
    lines: [],
    stations: [],
    count: 0,
    note: "路線與車站由 App 本機繪製，後台只提供時刻表",
  };
}
function listStations() {
  return localShape();
}
async function listStationsLive() {
  return localShape();
}
async function listShape() {
  return localShape();
}

/** live：只用 GitHub 日快取，不打 TDX */
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

  return {
    ok: true,
    cached: true,
    stationId: sid,
    stationName: (STATIONS.find((x) => x.stationId === sid) || {}).nameZh,
    date: trainDate,
    count: 0,
    trains: [],
    source: "github-cache-miss",
    updatedAt: new Date().toISOString(),
    note: "此站班表快取尚未就緒，請稍後再試（系統每日自動更新）",
  };
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
    .slice(0, Number(limit) > 0 ? Number(limit) : 400);
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

async function handleThsrQuery(query) {
  const q = query || {};
  const type = String(q.type || q.action || "summary").toLowerCase();
  if (type === "stations" || type === "list") return listStationsLive();
  if (type === "lines" || type === "shape" || type === "sequence") return listShape();
  if (["live", "liveboard", "board", "upcoming", "next", "departures", "timetable", "station-timetable", "station"].includes(type)) {
    return upcomingFromStation({ stationId: q.stationId || q.station || q.origin, date: q.date || q.trainDate, limit: q.limit });
  }
  const cred = getCredentials();
  return {
    ok: true,
    tdxConfigured: cred.configured,
    system: "THSR",
    systemName: "臺灣高鐵",
    note: "路線與車站由 App 本機繪製，後台只提供班表",
    usage: {
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
  stationTimetable,
  resolveStationId,
  STATIONS,
};
