/**
 * krtc loader
 * - lines：TDX Shape 真實軌道 WKT（geometry）
 * - sequence：地圖只回一條 mapPolyline（順逆行同軌，勿雙向重畫）
 * - timetable：優先 StationTimeTable
 * - live：分鐘／進站中（TDX LiveBoard）
 */
const https = require("https");

let cached = null;
let loading = null;

const LINE_TERMINALS = {
  R: ["岡山車站", "小港"],
  O: ["哈瑪星", "大寮"],
  C: ["旅運中心", "前鎮之星"],
};

const DEFAULT_HEADWAY = { R: 6, O: 7, C: 10 };

function loadRemote() {
  if (cached) return Promise.resolve(cached);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const url =
      "https://raw.githubusercontent.com/yonghong0333-ops/MapSky/fa4291f49d0e4e87d75ebee997e80cac8ecab86d/api/_lib/krtc.js";
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const m = { exports: {} };
            const vm = require("vm");
            const sandbox = {
              module: m,
              exports: m.exports,
              require,
              console,
              process,
              Buffer,
              setTimeout,
              clearTimeout,
              fetch,
              URL,
              URLSearchParams,
              TextEncoder,
              TextDecoder,
            };
            vm.runInNewContext(data, sandbox, { filename: "krtc-remote.js" });
            cached = sandbox.module.exports;
            resolve(cached);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
  return loading;
}

function lineKeyOfStation(stationId) {
  const id = String(stationId || "").toUpperCase();
  if (id.startsWith("R")) return "R";
  if (id.startsWith("O")) return "O";
  if (id.startsWith("C")) return "C";
  return null;
}

function taiwanNowHHMM() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.hour}:${parts.minute}`;
}

function minutesOf(hhmm) {
  if (!hhmm) return null;
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = Number(m[1]);
  if (h >= 24) h -= 24;
  return h * 60 + Number(m[2]);
}

function hhmmAdd(hhmm, addMins) {
  if (!hhmm) return null;
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let total = Number(m[1]) * 60 + Number(m[2]) + Number(addMins || 0);
  while (total < 0) total += 24 * 60;
  total = total % (24 * 60);
  const h = Math.floor(total / 60);
  const mi = total % 60;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

function normalizeEstimateMinutes(it) {
  const raw = it.estimateTime != null ? Number(it.estimateTime) : null;
  if (raw != null && Number.isFinite(raw)) {
    if (raw > 90) return Math.max(0, Math.round(raw / 60));
    return Math.max(0, Math.round(raw));
  }
  if (it.estimateMinutes != null && Number.isFinite(Number(it.estimateMinutes))) {
    return Math.max(0, Math.round(Number(it.estimateMinutes)));
  }
  return null;
}

function statusLabel(mins) {
  if (mins == null) return null;
  if (mins <= 0) return "進站中";
  return `${mins} 分鐘`;
}

function enrichLiveItems(items) {
  return (items || []).map((it) => {
    const name = (it.destinationName || it.tripHeadSign || "").trim() || null;
    const estimateMinutes = normalizeEstimateMinutes(it);
    const label = statusLabel(estimateMinutes);
    return {
      ...it,
      destinationName: name,
      headsign: name ? "往" + name : null,
      estimateMinutes,
      statusLabel: label,
      waitText: label,
    };
  });
}

/**
 * 地圖用站序：每個 line 只給一條 polyline
 */
function simplifySequenceForMap(seq) {
  if (!seq || !seq.ok) return seq;

  const sequences = Array.isArray(seq.sequences) ? seq.sequences : [];
  let primary = null;
  for (const s of sequences) {
    const n = (s.stops && s.stops.length) || s.stopCount || 0;
    const pn = primary ? (primary.stops && primary.stops.length) || primary.stopCount || 0 : -1;
    if (!primary || n > pn || (n === pn && s.direction === 0)) primary = s;
  }

  let stationIds = Array.isArray(seq.stationIds) ? seq.stationIds.slice() : [];
  let orderedStops = Array.isArray(seq.orderedStops) ? seq.orderedStops.slice() : [];

  if (primary && Array.isArray(primary.stops) && primary.stops.length) {
    const sorted = primary.stops.slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    stationIds = sorted.map((s) => s.stationId);
    if (!orderedStops.length) {
      orderedStops = sorted.map((s) => ({
        sequence: s.sequence,
        stationId: s.stationId,
        nameZh: s.nameZh || null,
        lat: s.lat != null ? s.lat : null,
        lon: s.lon != null ? s.lon : null,
      }));
    }
  }

  const directions = sequences.map((s) => ({
    direction: s.direction,
    lineId: s.lineId || null,
    stopCount: (s.stops && s.stops.length) || s.stopCount || 0,
    label: s.direction === 0 ? "順行" : s.direction === 1 ? "逆行" : "方向" + s.direction,
  }));

  return {
    ok: true,
    line: seq.line || null,
    mapPolyline: {
      stationIds,
      orderedStops,
      closed: seq.line && seq.line.lineKey === "C",
    },
    stationIds,
    orderedStops,
    directions,
    directionCount: directions.length,
    note:
      seq.line && seq.line.lineKey === "C"
        ? "環狀輕軌順行／逆行共軌，地圖請只畫 mapPolyline 一條。"
        : "順行／逆行共軌，地圖請只畫 mapPolyline 一條，不要把 sequences 雙向都畫上。",
  };
}

async function buildUpcoming(mod, query) {
  const q = query || {};
  const line = q.line || q.lineId || null;
  const stationId = q.stationId || q.station || null;
  if (typeof mod.upcomingDepartures === "function") {
    const up = await mod.upcomingDepartures({ line, stationId });
    if (up && up.ok) return up;
  }
  if (typeof mod.timetableSummary === "function") {
    return mod.timetableSummary({ line, stationId });
  }
  return { ok: false, reason: "timetable-unavailable" };
}

const METRO_API_BASE = "https://tdx.transportdata.tw/api/basic/v2/Rail/Metro";
const TOKEN_URL =
  "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";

const shapeMem = {};

function getShapeCache(name, ttlMs) {
  if (shapeMem[name] && Date.now() - shapeMem[name].fetchedAt < ttlMs) {
    return shapeMem[name].data;
  }
  return null;
}

function setShapeCache(name, data) {
  shapeMem[name] = { data, fetchedAt: Date.now() };
}

async function fetchTdxToken() {
  const clientId = process.env.TDX_CLIENT_ID || "";
  const clientSecret = process.env.TDX_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) return null;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) return null;
  const j = await resp.json();
  return j.access_token || null;
}

async function tdxGet(path, { query = "" } = {}) {
  const token = await fetchTdxToken();
  if (!token) return { ok: false, reason: "tdx-not-configured" };
  const url = `${METRO_API_BASE}${path}${query ? (path.includes("?") ? "&" : "?") + query.replace(/^\?/, "") : ""}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (resp.status === 429) return { ok: false, reason: "tdx-rate-limit" };
  if (!resp.ok) return { ok: false, reason: "tdx-error", status: resp.status };
  const data = await resp.json();
  return { ok: true, data };
}

async function fetchShape(system) {
  const cacheKey = `shape-${system}`;
  const hit = getShapeCache(cacheKey, 24 * 3600 * 1000);
  if (hit) return { ok: true, data: hit, cached: true };
  const res = await tdxGet(`/Shape/${system}`, { query: "$format=JSON&$top=50" });
  if (!res.ok) return res;
  const list = Array.isArray(res.data) ? res.data : [];
  setShapeCache(cacheKey, list);
  return { ok: true, data: list, cached: false };
}

async function listLinesWithShape(mod) {
  const base = typeof mod.listLines === "function" ? await mod.listLines() : { ok: true, lines: [] };
  const systems = ["KRTC", "KLRT"];
  for (const sys of systems) {
    try {
      await fetchShape(sys);
    } catch (_) {}
  }
  return {
    ...base,
    note: "geometry 為 TDX Shape WKT（經度在前）。無 geometry 時請用 mapPolyline 站序連線。",
  };
}

async function handleKrtcQuery(query) {
  const mod = await loadRemote();
  const q = query || {};
  const type = String(q.type || q.action || "summary").toLowerCase();

  if (
    type === "timetable" ||
    type === "schedule" ||
    type === "upcoming" ||
    type === "next" ||
    type === "departures" ||
    type === "station-timetable" ||
    type === "station_timetable" ||
    type === "stt"
  ) {
    return buildUpcoming(mod, q);
  }

  if (type === "lines" || type === "line") {
    return listLinesWithShape(mod);
  }

  if (type === "sequence" || type === "station-of-line") {
    const seq = await mod.stationSequence({ line: q.line || q.lineId || null });
    return simplifySequenceForMap(seq);
  }

  // 即時到站（TDX LiveBoard）
  if (type === "live" || type === "liveboard" || type === "board") {
    const r = await mod.liveBoard({
      line: q.line || q.lineId || null,
      stationId: q.stationId || q.station || null,
    });
    if (r && r.ok && Array.isArray(r.items)) {
      r.items = enrichLiveItems(r.items);
    }
    if (r && r.ok) {
      r.type = "live";
      r.usage = {
        all: "?type=live",
        byLine: "?type=live&line=R",
        byStation: "?type=live&stationId=R7",
      };
    }
    return r;
  }

  const result = await mod.handleKrtcQuery(query);
  return result;
}

module.exports = {
  handleKrtcQuery,
  listLines: async (...a) => listLinesWithShape(await loadRemote()),
  listLinesWithShape: async () => listLinesWithShape(await loadRemote()),
  fetchShape,
  listStations: async (...a) => (await loadRemote()).listStations(...a),
  stationSequence: async (opts) => {
    const mod = await loadRemote();
    const seq = await mod.stationSequence(opts || {});
    return simplifySequenceForMap(seq);
  },
  liveBoard: async (...a) => {
    const mod = await loadRemote();
    const r = await mod.liveBoard(...a);
    if (r && r.ok && Array.isArray(r.items)) r.items = enrichLiveItems(r.items);
    return r;
  },
  firstLastTrain: async (...a) => (await loadRemote()).firstLastTrain(...a),
  frequency: async (...a) => (await loadRemote()).frequency(...a),
  stationTimetable: async (...a) => (await loadRemote()).stationTimetable(...a),
  timetableSummary: async (opts) => buildUpcoming(await loadRemote(), opts || {}),
  upcomingDepartures: async (opts) => buildUpcoming(await loadRemote(), opts || {}),
  getCredentials: () => {
    const clientId = process.env.TDX_CLIENT_ID || "";
    const clientSecret = process.env.TDX_CLIENT_SECRET || "";
    return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
  },
  normalizeLineKey: (raw) => {
    if (raw == null || raw === "") return null;
    const s = String(raw).trim().toUpperCase();
    if (s === "R" || s === "RED" || s.includes("紅")) return "R";
    if (s === "O" || s === "ORANGE" || s.includes("橘") || s.includes("橙")) return "O";
    if (s === "C" || s === "CIRCLE" || s.includes("環") || s.includes("輕軌")) return "C";
    return s.length === 1 ? s : null;
  },
};
