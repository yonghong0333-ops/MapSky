/**
 * krtc loader
 * - lines：TDX Shape 真實軌道 WKT（geometry）
 * - sequence：地圖只回一條 mapPolyline（順逆行同軌，勿雙向重畫）
 * - timetable：優先 StationTimeTable
 * - live：分鐘／進站中
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
  total = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const mi = total % 60;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

function normalizeClock(hhmm) {
  if (!hhmm) return null;
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(hhmm).slice(0, 5);
  let h = Number(m[1]);
  const mi = m[2];
  if (h >= 24) return `${String(h - 24).padStart(2, "0")}:${mi}`;
  return `${String(h).padStart(2, "0")}:${mi}`;
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
 * 順行／逆行走同一條實體軌道，畫兩次會變雙線／三線
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

function weekdayServiceOk(serviceDay) {
  if (!serviceDay || typeof serviceDay !== "object") return true;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const tw = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const name = days[tw.getDay()];
  if (serviceDay[name] === false || serviceDay[name] === 0) return false;
  return true;
}

function itemsFromStationTimetable(st, stationId, nowHHMM, limitPerDest) {
  if (!st || !st.ok || !Array.isArray(st.items) || !st.items.length) return null;
  const nowMin = minutesOf(nowHHMM);
  const byDest = new Map();

  for (const row of st.items) {
    if (!weekdayServiceOk(row.serviceDay)) continue;
    const t = normalizeClock(row.departureTime || row.arrivalTime);
    if (!t) continue;
    const tm = minutesOf(t);
    if (tm == null || nowMin == null) continue;
    if (tm < nowMin - 1) continue;
    if (tm > nowMin + 180) continue;

    let name = (row.destinationName || "").trim();
    if (!name) {
      const lk = lineKeyOfStation(stationId);
      if (lk && LINE_TERMINALS[lk]) {
        const idx = row.direction != null ? Number(row.direction) % 2 : 0;
        name = LINE_TERMINALS[lk][idx] || LINE_TERMINALS[lk][0];
      } else name = "—";
    }
    if (!byDest.has(name)) byDest.set(name, []);
    byDest.get(name).push({
      departureTime: t,
      destinationName: name,
      direction: row.direction != null ? Number(row.direction) : null,
      estimateMinutes: Math.max(0, tm - nowMin),
      source: "timetable",
      stationId: stationId || null,
      headsign: "往" + name,
      statusLabel: statusLabel(Math.max(0, tm - nowMin)),
      waitText: statusLabel(Math.max(0, tm - nowMin)),
    });
  }

  if (!byDest.size) return null;

  const out = [];
  for (const [, list] of byDest.entries()) {
    list.sort((a, b) => minutesOf(a.departureTime) - minutesOf(b.departureTime));
    const seen = new Set();
    let n = 0;
    for (const it of list) {
      if (seen.has(it.departureTime)) continue;
      seen.add(it.departureTime);
      out.push(it);
      n++;
      if (n >= (limitPerDest || 4)) break;
    }
  }
  out.sort((a, b) => {
    const dn = String(a.destinationName).localeCompare(String(b.destinationName), "zh-Hant");
    if (dn !== 0) return dn;
    return minutesOf(a.departureTime) - minutesOf(b.departureTime);
  });
  return out;
}

function pickHeadway(result, lk) {
  const freqs = result.frequency || [];
  for (const f of freqs) {
    const off = f.offPeakHeadwayMins || f.OffPeakHeadway;
    const peak = f.peakHeadwayMins || f.PeakHeadway;
    if (off || peak) return Number(off || peak);
  }
  return DEFAULT_HEADWAY[lk] || 8;
}

function collectDestinations(result) {
  const set = new Map();
  const add = (name, direction) => {
    const n = (name || "").trim();
    if (!n || n === "一" || n === "-") return;
    const key = n + "|" + (direction == null ? "" : String(direction));
    if (!set.has(key)) set.set(key, { destinationName: n, direction: direction == null ? null : Number(direction) });
  };
  for (const it of result.items || []) add(it.destinationName || it.tripHeadSign, it.direction);
  for (const it of result.firstLast || []) add(it.destinationName, it.direction);
  return [...set.values()];
}

function enrichUpcomingFallback(result, stationId) {
  if (!result || !result.ok) return result;
  const rawItems = Array.isArray(result.items) ? result.items : [];
  const lk = lineKeyOfStation(stationId) || (result.line && result.line.lineKey) || null;
  let dests = collectDestinations(result);
  if (!dests.length && lk && LINE_TERMINALS[lk]) {
    dests = LINE_TERMINALS[lk].map((name, i) => ({ destinationName: name, direction: i }));
  }

  const fixed = rawItems.map((it, idx) => {
    let name = (it.destinationName || it.tripHeadSign || "").trim();
    if (!name || name === "一" || name === "-") {
      if (dests.length === 1) name = dests[0].destinationName;
      else if (dests.length > 1) {
        const byDir = dests.find((d) => d.direction != null && d.direction === it.direction);
        name = (byDir || dests[idx % dests.length]).destinationName;
      } else name = null;
    }
    const estimateMinutes = normalizeEstimateMinutes(it);
    return {
      ...it,
      destinationName: name,
      headsign: name ? "往" + name : null,
      estimateMinutes,
      statusLabel: statusLabel(estimateMinutes),
      waitText: statusLabel(estimateMinutes),
    };
  });

  const headway = pickHeadway(result, lk);
  const now = result.now || taiwanNowHHMM();
  const slotsPerDest = 4;
  const byDest = new Map();
  for (const it of fixed) {
    if (!it.destinationName) continue;
    if (!byDest.has(it.destinationName)) byDest.set(it.destinationName, []);
    byDest.get(it.destinationName).push(it);
  }
  if (byDest.size === 0 && dests.length) {
    for (const d of dests) byDest.set(d.destinationName, []);
  }

  const expanded = [];
  for (const [name, list] of byDest.entries()) {
    list.sort((a, b) => (minutesOf(a.departureTime) ?? 1e9) - (minutesOf(b.departureTime) ?? 1e9));
    const base = list[0] && list[0].departureTime ? list[0].departureTime : now;
    const dir =
      list[0] && list[0].direction != null
        ? list[0].direction
        : (dests.find((d) => d.destinationName === name) || {}).direction;
    const times = new Set();
    if (list[0] && list[0].departureTime) times.add(list[0].departureTime);
    const baseMin = minutesOf(base);
    const nowMin = minutesOf(now);
    let startOffset = 0;
    if (baseMin != null && nowMin != null && Math.abs(baseMin - nowMin) <= 1) startOffset = headway;
    for (let i = 0; i < slotsPerDest + 2; i++) {
      const add = startOffset + headway * i;
      if (add === 0 && times.size) continue;
      const next = hhmmAdd(base, add === 0 ? headway : add);
      if (next) times.add(next);
      if (times.size >= slotsPerDest) break;
    }
    for (const it of list) if (it.departureTime) times.add(it.departureTime);
    const sorted = [...times].sort((a, b) => (minutesOf(a) ?? 0) - (minutesOf(b) ?? 0));
    const upcoming = sorted
      .filter((t) => {
        const m = minutesOf(t);
        if (m == null || nowMin == null) return true;
        return m >= nowMin - 1 || m < 5;
      })
      .slice(0, slotsPerDest);
    for (const t of upcoming) {
      const est = minutesOf(t) != null && nowMin != null ? Math.max(0, minutesOf(t) - nowMin) : null;
      expanded.push({
        departureTime: t,
        destinationName: name,
        direction: dir != null ? dir : null,
        estimateMinutes: est,
        statusLabel: statusLabel(est),
        waitText: statusLabel(est),
        source: list[0] && list[0].source === "live" && t === list[0].departureTime ? "live" : "frequency-estimate",
        stationId: stationId || null,
        lineKey: lk,
        headsign: "往" + name,
      });
    }
  }

  expanded.sort((a, b) => {
    const dn = String(a.destinationName || "").localeCompare(String(b.destinationName || ""), "zh-Hant");
    if (dn !== 0) return dn;
    return (minutesOf(a.departureTime) ?? 0) - (minutesOf(b.departureTime) ?? 0);
  });

  return {
    ...result,
    now,
    headwayMinutes: headway,
    items: expanded,
    count: expanded.length,
    scheduleSource: "frequency-estimate",
  };
}

async function buildUpcoming(mod, query) {
  const stationId = query.stationId || query.station || null;
  const line = query.line || null;
  const now = taiwanNowHHMM();

  let st = null;
  try {
    if (stationId && typeof mod.stationTimetable === "function") {
      st = await mod.stationTimetable({ line, stationId });
    }
  } catch (_) {
    st = null;
  }
  const fromTable = itemsFromStationTimetable(st, stationId, now, 4);
  if (fromTable && fromTable.length) {
    return {
      ok: true,
      stationId,
      line: (st && st.line) || null,
      now,
      count: fromTable.length,
      items: fromTable,
      scheduleSource: "station-timetable",
      note: "依 TDX 站別時刻表",
    };
  }

  let base = null;
  try {
    if (typeof mod.upcomingDepartures === "function") {
      base = await mod.upcomingDepartures({ line, stationId });
    } else if (typeof mod.timetableSummary === "function") {
      base = await mod.timetableSummary({ line, stationId });
    }
  } catch (_) {
    base = { ok: true, items: [] };
  }
  const enriched = enrichUpcomingFallback(base || { ok: true, items: [] }, stationId);
  return {
    ...enriched,
    note: (st && st.note) || "TDX 站別時刻表無資料，改以即時／班距推估",
  };
}

// ── TDX Shape：真實軌道線形（WKT）────────────────────────────────
const METRO_API_BASE = "https://tdx.transportdata.tw/api/basic/v2/Rail/Metro";
const TOKEN_URL =
  "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const CACHE_TTL_STATIC_MS = 6 * 60 * 60 * 1000;
const TOKEN_SKEW_MS = 60 * 1000;

let memoryToken = null;
const shapeMem = {};

function shapeTmp(name) {
  const path = require("path");
  const os = require("os");
  return path.join(os.tmpdir(), `nexora-krtc-${name}.json`);
}

function readShapeCache(name, ttlMs) {
  if (shapeMem[name] && Date.now() - shapeMem[name].fetchedAt < ttlMs) {
    return shapeMem[name].data;
  }
  try {
    const fs = require("fs");
    const raw = JSON.parse(fs.readFileSync(shapeTmp(name), "utf-8"));
    if (raw && raw.fetchedAt && Date.now() - raw.fetchedAt < ttlMs) {
      shapeMem[name] = raw;
      return raw.data;
    }
  } catch {
    /* no cache */
  }
  return null;
}

function writeShapeCache(name, data) {
  const payload = { data, fetchedAt: Date.now() };
  shapeMem[name] = payload;
  try {
    const fs = require("fs");
    fs.writeFileSync(shapeTmp(name), JSON.stringify(payload), "utf-8");
  } catch {
    /* ignore */
  }
}

async function getMetroAccessToken() {
  const clientId = process.env.TDX_CLIENT_ID || "";
  const clientSecret = process.env.TDX_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    return { ok: false, reason: "tdx-not-configured" };
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

async function tdxMetroGet(apiPath, query) {
  const tok = await getMetroAccessToken();
  if (!tok.ok) return tok;
  const q = query ? (apiPath.includes("?") ? "&" : "?") + query : "";
  const url = `${METRO_API_BASE}${apiPath}${q}`;
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

/** TDX Rail/Metro/Shape — Geometry 為 WKT（經度在前） */
async function fetchShape(system) {
  const cacheKey = `shape-${system}`;
  const cached = readShapeCache(cacheKey, CACHE_TTL_STATIC_MS * 4);
  if (cached) return { ok: true, data: cached, cached: true };
  const res = await tdxMetroGet(`/Shape/${system}`, "$format=JSON");
  if (!res.ok) return res;
  const list = Array.isArray(res.data) ? res.data : [];
  writeShapeCache(cacheKey, list);
  return { ok: true, data: list, cached: false };
}

function normalizeLineKeyLocal(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().toUpperCase();
  if (s === "R" || s === "RED" || s.includes("紅")) return "R";
  if (s === "O" || s === "ORANGE" || s.includes("橘") || s.includes("橙")) return "O";
  if (s === "G" || s === "GREEN" || s === "C" || s === "LRT" || s.includes("綠") || s.includes("輕軌") || s.includes("環狀"))
    return "C";
  if (s.startsWith("R")) return "R";
  if (s.startsWith("O")) return "O";
  if (s.startsWith("C")) return "C";
  return s;
}

/**
 * listLines + 每條線 geometry（WKT；多段用 ; 串）
 * 抓不到線形時 geometry=null，App 退回站序連線
 */
async function listLinesWithShape(mod) {
  const base = typeof mod.listLines === "function" ? await mod.listLines() : mod.listLines();
  if (!base || !base.ok) return base;
  const geoms = { R: [], O: [], C: [] };
  for (const sys of ["KRTC", "KLRT"]) {
    const res = await fetchShape(sys);
    if (!res.ok) continue;
    for (const row of res.data || []) {
      const name =
        row.LineName && (row.LineName.Zh_tw || row.LineName.Zh || row.LineName);
      const key = normalizeLineKeyLocal(row.LineID || row.LineNo || name);
      if (key && geoms[key] && row.Geometry) geoms[key].push(String(row.Geometry));
    }
  }
  const lines = (base.lines || []).map((l) => ({
    ...l,
    geometry: geoms[l.lineKey] && geoms[l.lineKey].length ? geoms[l.lineKey].join(";") : null,
  }));
  return {
    ...base,
    lines,
    shapeSource: "tdx-metro-shape",
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

  const result = await mod.handleKrtcQuery(query);

  if ((type === "live" || type === "liveboard" || type === "board") && result && result.ok && Array.isArray(result.items)) {
    result.items = enrichLiveItems(result.items);
  }

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
    if (s === "G" || s === "GREEN" || s === "C" || s === "LRT" || s.includes("綠") || s.includes("輕軌") || s.includes("環狀"))
      return "C";
    if (s.startsWith("R")) return "R";
    if (s.startsWith("O")) return "O";
    if (s.startsWith("C")) return "C";
    return s;
  },
};
