/**
 * 臺灣高鐵（THSR）— TDX v2
 * 環境變數：TDX_CLIENT_ID、TDX_CLIENT_SECRET（與捷運／臺鐵共用）
 *
 * 站碼：0990 南港、1000 台北、1010 板橋、1020 桃園、1030 新竹、1040 苗栗、
 *       1050 台中、1060 彰化、1070 雲林、1080 嘉義、1090 台南、1100 左營
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const TOKEN_URL =
  "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const API_BASE = "https://tdx.transportdata.tw/api/basic/v2/Rail/THSR";

const CACHE_TTL_STATIC_MS = 12 * 60 * 60 * 1000;
const CACHE_TTL_LIVE_MS = 5 * 60 * 1000; // 剩餘座位約 10 分鐘更新，快取 5 分
const TOKEN_SKEW_MS = 60 * 1000;

let memoryToken = null;

/** 固定 12 站（TDX 站碼長期穩定） */
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
// 常見別名
NAME_TO_ID["臺北"] = "1000";
NAME_TO_ID["台北站"] = "1000";
NAME_TO_ID["高鐵台北"] = "1000";
NAME_TO_ID["臺中"] = "1050";
NAME_TO_ID["臺南"] = "1090";
NAME_TO_ID["高雄"] = "1100";
NAME_TO_ID["左營站"] = "1100";
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
  if (/^\d{4}$/.test(s)) return s;
  const key = s.replace(/台/g, "臺");
  if (NAME_TO_ID[s]) return NAME_TO_ID[s];
  if (NAME_TO_ID[key]) return NAME_TO_ID[key];
  if (NAME_TO_ID[s.toLowerCase()]) return NAME_TO_ID[s.toLowerCase()];
  // 模糊
  for (const st of STATIONS) {
    if (st.nameZh.includes(s) || s.includes(st.nameZh)) return st.stationId;
  }
  return null;
}

function todayYmd() {
  const d = new Date();
  // 用台北時間大概：UTC+8
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
}

function listStations() {
  return {
    ok: true,
    count: STATIONS.length,
    stations: STATIONS.map((s) => ({ ...s })),
  };
}

/** 起迄時刻表 */
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
  if (cached) return { ok: true, cached: true, ...cached };

  const apiPath = `/DailyTimetable/OD/${encodeURIComponent(originId)}/to/${encodeURIComponent(destId)}/${encodeURIComponent(trainDate)}`;
  const res = await tdxGet(apiPath, "$format=JSON");
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
  writeCache(cacheKey, payload);
  return { ok: true, cached: false, ...payload };
}

/** 指定站當日時刻表 */
async function stationTimetable({ stationId, date } = {}) {
  const sid = resolveStationId(stationId);
  if (!sid) return { ok: false, reason: "missing-stationId", hint: "請帶 stationId 或站名" };
  const trainDate = date || todayYmd();
  const cacheKey = `st-${sid}-${trainDate}`;
  const cached = readCache(cacheKey, CACHE_TTL_LIVE_MS);
  if (cached) return { ok: true, cached: true, ...cached };

  const apiPath = `/DailyTimetable/Station/${encodeURIComponent(sid)}/${encodeURIComponent(trainDate)}`;
  const res = await tdxGet(apiPath, "$format=JSON");
  if (!res.ok) return res;
  const list = Array.isArray(res.data) ? res.data : [];
  const items = list.map((row) => ({
    trainNo: row.TrainNo || (row.DailyTrainInfo && row.DailyTrainInfo.TrainNo),
    direction: row.Direction != null ? Number(row.Direction) : null,
    arrivalTime: row.ArrivalTime || null,
    departureTime: row.DepartureTime || null,
    endingStationName: zhName(row.EndingStationName) || zhName(row.DailyTrainInfo && row.DailyTrainInfo.EndingStationName),
  }));
  items.sort((a, b) =>
    String(a.departureTime || a.arrivalTime || "").localeCompare(String(b.departureTime || b.arrivalTime || ""))
  );
  const payload = {
    stationId: sid,
    stationName: (STATIONS.find((s) => s.stationId === sid) || {}).nameZh,
    date: trainDate,
    count: items.length,
    items,
    updatedAt: new Date().toISOString(),
  };
  writeCache(cacheKey, payload);
  return { ok: true, cached: false, ...payload };
}

/** 起迄剩餘座位 */
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

  const apiPath = `/AvailableSeatStatus/Train/OD/${encodeURIComponent(originId)}/to/${encodeURIComponent(destId)}/TrainDate/${encodeURIComponent(trainDate)}`;
  const res = await tdxGet(apiPath, "$format=JSON");
  if (!res.ok) return res;
  const raw = res.data;
  const list = Array.isArray(raw) ? raw : raw.AvailableSeats || raw.Items || [];
  const trains = list.map((row) => ({
    trainNo: row.TrainNo,
    direction: row.Direction != null ? Number(row.Direction) : null,
    stopStations: (row.StopStations || []).map((st) => ({
      stationId: st.StationID,
      nameZh: zhName(st.StationName),
      standardSeatStatus: st.StandardSeatStatus, // Available / Limited / Full 等
      businessSeatStatus: st.BusinessSeatStatus,
    })),
  }));
  const payload = {
    originStationId: originId,
    destinationStationId: destId,
    date: trainDate,
    count: trains.length,
    trains,
    updatedAt: new Date().toISOString(),
    note: "今日剩餘座位約每 10 分鐘更新；非今日為每日固定時段更新",
  };
  writeCache(cacheKey, payload);
  return { ok: true, cached: false, ...payload };
}

/** 票價 */
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

  if (type === "stations") return listStations();
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
    stations: STATIONS,
    usage: {
      stations: "?type=stations",
      timetable: "?type=timetable&origin=1000&destination=1100&date=2026-10-21",
      stationTimetable: "?type=station-timetable&stationId=1100",
      seats: "?type=seats&origin=台北&destination=左營",
      fare: "?type=fare&origin=1000&destination=1100",
    },
  };
}

module.exports = {
  handleThsrQuery,
  listStations,
  odTimetable,
  stationTimetable,
  availableSeats,
  odFare,
  resolveStationId,
  STATIONS,
};
