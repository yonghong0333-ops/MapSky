/**
 * 高雄捷運 / 輕軌（TDX）
 * - KRTC：紅線(R)、橘線(O)
 * - KLRT：環狀輕軌
 * 環境變數：TDX_CLIENT_ID、TDX_CLIENT_SECRET
 * vercel rewrite：/api/transit/krtc -> wind?transit=krtc（type= 由客戶端帶）
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const TOKEN_URL =
  "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const API_BASE = "https://tdx.transportdata.tw/api/basic/v2/Rail/Metro";

const CACHE_TTL_STATIC_MS = 6 * 60 * 60 * 1000;
const CACHE_TTL_LIVE_MS = 20 * 1000;
const TOKEN_SKEW_MS = 60 * 1000;

let memoryToken = null;

function tmpPath(name) {
  return path.join(os.tmpdir(), `nexora-krtc-${name}.json`);
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

async function tdxGet(apiPath, { query = "" } = {}) {
  const tok = await getAccessToken();
  if (!tok.ok) return tok;
  const url = `${API_BASE}${apiPath}${query ? (apiPath.includes("?") ? "&" : "?") + query : ""}`;
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

function normalizeLineKey(raw) {
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

function stationLineOf(stationId) {
  const id = String(stationId || "");
  if (id.startsWith("R") || id.startsWith("RK")) return "R";
  if (id.startsWith("O") || id.startsWith("OT")) return "O";
  if (id.startsWith("C")) return "C";
  return null;
}

function lineMeta(key) {
  if (key === "R")
    return { lineKey: "R", lineId: "R", nameZh: "紅線", nameEn: "Red Line", color: "#e3002c", system: "KRTC", systemName: "高雄捷運" };
  if (key === "O")
    return { lineKey: "O", lineId: "O", nameZh: "橘線", nameEn: "Orange Line", color: "#f7a600", system: "KRTC", systemName: "高雄捷運" };
  if (key === "C")
    return { lineKey: "C", lineId: "C", nameZh: "環狀輕軌", nameEn: "Circular Light Rail", color: "#00a19b", system: "KLRT", systemName: "高雄輕軌" };
  return null;
}

function zhOf(obj) {
  if (!obj) return null;
  if (typeof obj === "string") return obj;
  return obj.Zh_tw || obj.Zh || obj.En || null;
}

function taiwanNowParts() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    hhmm: `${parts.hour}:${parts.minute}`,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function hhmmAdd(hhmm, addMins) {
  if (!hhmm || typeof hhmm !== "string") return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let total = Number(m[1]) * 60 + Number(m[2]) + Number(addMins || 0);
  total = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const mi = total % 60;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

function minutesOf(hhmm) {
  if (!hhmm) return null;
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
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

async function fetchStations(system) {
  const cacheKey = `stations-${system}`;
  const cached = readCache(cacheKey, CACHE_TTL_STATIC_MS);
  if (cached) return { ok: true, data: cached, cached: true };
  const res = await tdxGet(`/Station/${system}`, { query: "$format=JSON" });
  if (!res.ok) return res;
  const list = Array.isArray(res.data) ? res.data : [];
  writeCache(cacheKey, list);
  return { ok: true, data: list, cached: false };
}

async function fetchStationOfLine(system) {
  const cacheKey = `sol-${system}`;
  const cached = readCache(cacheKey, CACHE_TTL_STATIC_MS);
  if (cached) return { ok: true, data: cached, cached: true };
  const res = await tdxGet(`/StationOfLine/${system}`, { query: "$format=JSON" });
  if (!res.ok) return res;
  const list = Array.isArray(res.data) ? res.data : [];
  writeCache(cacheKey, list);
  return { ok: true, data: list, cached: false };
}

async function fetchLiveBoard(system) {
  const cacheKey = `live-${system}`;
  const cached = readCache(cacheKey, CACHE_TTL_LIVE_MS);
  if (cached) return { ok: true, data: cached, cached: true };
  const res = await tdxGet(`/LiveBoard/${system}`, { query: "$format=JSON&$top=500" });
  if (!res.ok) return res;
  const list = Array.isArray(res.data) ? res.data : [];
  writeCache(cacheKey, list);
  return { ok: true, data: list, cached: false };
}

async function fetchFirstLast(system) {
  const cacheKey = `firstlast-${system}`;
  const cached = readCache(cacheKey, CACHE_TTL_STATIC_MS);
  if (cached) return { ok: true, data: cached, cached: true };
  const res = await tdxGet(`/FirstLastTimetable/${system}`, { query: "$format=JSON&$top=500" });
  if (!res.ok) return res;
  const list = Array.isArray(res.data) ? res.data : [];
  writeCache(cacheKey, list);
  return { ok: true, data: list, cached: false };
}

async function fetchFrequency(system) {
  const cacheKey = `freq-${system}`;
  const cached = readCache(cacheKey, CACHE_TTL_STATIC_MS);
  if (cached) return { ok: true, data: cached, cached: true };
  const res = await tdxGet(`/Frequency/${system}`, { query: "$format=JSON&$top=200" });
  if (!res.ok) return res;
  const list = Array.isArray(res.data) ? res.data : [];
  writeCache(cacheKey, list);
  return { ok: true, data: list, cached: false };
}

async function fetchStationTimeTable(system) {
  const cacheKey = `stt-${system}`;
  const cached = readCache(cacheKey, CACHE_TTL_STATIC_MS);
  if (cached) return { ok: true, data: cached, cached: true };
  const res = await tdxGet(`/StationTimeTable/${system}`, { query: "$format=JSON&$top=3000" });
  if (!res.ok) return res;
  const list = Array.isArray(res.data) ? res.data : [];
  writeCache(cacheKey, list);
  return { ok: true, data: list, cached: false };
}

function mapStation(s) {
  const id = s.StationID || s.StationId;
  const lat = s.StationPosition && (s.StationPosition.PositionLat || s.StationPosition.lat);
  const lon = s.StationPosition && (s.StationPosition.PositionLon || s.StationPosition.lon);
  return {
    stationId: id,
    nameZh: zhOf(s.StationName) || id,
    nameEn: (s.StationName && s.StationName.En) || null,
    lineKey: stationLineOf(id),
    lat: lat != null ? Number(lat) : null,
    lon: lon != null ? Number(lon) : null,
  };
}

function mapLive(row) {
  return {
    stationId: row.StationID,
    stationName: zhOf(row.StationName),
    tripHeadSign: row.TripHeadSign || null,
    destinationName: zhOf(row.DestinationName) || zhOf(row.DestinationStationName),
    estimateTime: row.EstimateTime != null ? Number(row.EstimateTime) : null,
    estimateMinutes:
      row.EstimateTime != null && Number.isFinite(Number(row.EstimateTime))
        ? Math.max(0, Math.round(Number(row.EstimateTime) / 60))
        : null,
    direction: row.Direction != null ? Number(row.Direction) : null,
    srcUpdateTime: row.SrcUpdateTime || row.UpdateTime || null,
  };
}

function listLines() {
  return {
    ok: true,
    lines: [lineMeta("R"), lineMeta("O"), lineMeta("C")],
    note: "高雄捷運正式路線為紅線、橘線；無官方綠線，輕軌用 line=C。",
  };
}

async function listStations({ line = null } = {}) {
  const key = normalizeLineKey(line);
  const systems = key === "C" ? ["KLRT"] : key ? ["KRTC"] : ["KRTC", "KLRT"];
  const stations = [];
  for (const sys of systems) {
    const res = await fetchStations(sys);
    if (!res.ok) return res;
    for (const s of res.data) {
      const mapped = mapStation(s);
      if (key && mapped.lineKey !== key) continue;
      stations.push(mapped);
    }
  }
  stations.sort((a, b) => String(a.stationId).localeCompare(String(b.stationId)));
  const slim = stations.map((s) => ({ stationId: s.stationId, nameZh: s.nameZh, lat: s.lat, lon: s.lon }));
  return { ok: true, line: key ? lineMeta(key) : null, count: slim.length, stations: slim };
}

async function stationSequence({ line } = {}) {
  const key = normalizeLineKey(line) || "R";
  const meta = lineMeta(key);
  if (!meta) return { ok: false, reason: "bad-line" };
  const res = await fetchStationOfLine(meta.system);
  if (!res.ok) return res;
  const sequences = [];
  for (const route of res.data || []) {
    const lineId = String(route.LineID || route.LineId || "");
    const match =
      key === "R" ? lineId === "R" || lineId.startsWith("R") : key === "O" ? lineId === "O" || lineId.startsWith("O") : true;
    if (key !== "C" && !match) continue;
    const stops = (route.Stations || []).map((st, i) => ({
      sequence: st.Sequence != null ? st.Sequence : i + 1,
      stationId: st.StationID,
      nameZh: zhOf(st.StationName),
      nameEn: (st.StationName && st.StationName.En) || null,
    }));
    sequences.push({ lineId, direction: route.Direction != null ? Number(route.Direction) : null, stops });
  }
  const primary = sequences.find((s) => s.direction === 0) || sequences[0] || null;
  const stationIds = primary
    ? primary.stops.slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0)).map((s) => s.stationId)
    : [];
  return { ok: true, line: meta, stationIds, sequences };
}

async function liveBoard({ line = null, stationId = null } = {}) {
  const key = normalizeLineKey(line);
  const sid = stationId ? String(stationId).trim().toUpperCase() : null;
  const systems = [];
  if (sid) systems.push(stationLineOf(sid) === "C" ? "KLRT" : "KRTC");
  else if (key === "C") systems.push("KLRT");
  else if (key === "R" || key === "O") systems.push("KRTC");
  else systems.push("KRTC", "KLRT");
  const boards = [];
  const errors = [];
  for (const sys of systems) {
    const res = await fetchLiveBoard(sys);
    if (!res.ok) {
      errors.push({ system: sys, reason: res.reason || res.status || "error" });
      continue;
    }
    for (const row of res.data || []) {
      const id = String(row.StationID || "");
      if (sid && id !== sid) continue;
      const lk = stationLineOf(id);
      if (key && lk !== key) continue;
      boards.push({ ...mapLive(row), lineKey: lk, system: sys });
    }
  }
  boards.sort((a, b) => (a.estimateTime == null ? 1e12 : a.estimateTime) - (b.estimateTime == null ? 1e12 : b.estimateTime));
  return {
    ok: true,
    line: key ? lineMeta(key) : null,
    stationId: sid,
    count: boards.length,
    items: boards,
    errors: errors.length ? errors : undefined,
    updatedAt: new Date().toISOString(),
  };
}

async function firstLastTrain({ line = null, stationId = null } = {}) {
  const key = normalizeLineKey(line);
  const sid = stationId ? String(stationId).trim().toUpperCase() : null;
  const systems = [];
  if (sid) systems.push(stationLineOf(sid) === "C" ? "KLRT" : "KRTC");
  else if (key === "C") systems.push("KLRT");
  else if (key === "R" || key === "O") systems.push("KRTC");
  else systems.push("KRTC", "KLRT");
  const items = [];
  for (const sys of systems) {
    const res = await fetchFirstLast(sys);
    if (!res.ok) {
      return {
        ok: true,
        line: key ? lineMeta(key) : null,
        stationId: sid,
        count: 0,
        items: [],
        note: "TDX FirstLastTimetable 無法取得（" + (res.reason || res.status || "error") + "）",
      };
    }
    for (const row of res.data || []) {
      const id = String(row.StationID || "");
      if (sid && id !== sid) continue;
      const lk = stationLineOf(id);
      if (key && lk !== key) continue;
      items.push({
        stationId: id,
        stationName: zhOf(row.StationName) || id,
        lineKey: lk || (row.LineID ? String(row.LineID)[0] : null),
        lineId: row.LineID || null,
        direction: row.Direction != null ? Number(row.Direction) : null,
        destinationStationId: row.DestinationStationID || null,
        destinationName: zhOf(row.DestinationStationName),
        trainType: row.TrainType || null,
        firstTrainTime: normalizeClock(row.FirstTrainTime) || row.FirstTrainTime || null,
        lastTrainTime: normalizeClock(row.LastTrainTime) || row.LastTrainTime || null,
        firstTrainTimeRaw: row.FirstTrainTime || null,
        lastTrainTimeRaw: row.LastTrainTime || null,
        serviceDay: row.ServiceDay || null,
        system: sys,
      });
    }
  }
  items.sort((a, b) => String(a.stationId).localeCompare(String(b.stationId)));
  return { ok: true, line: key ? lineMeta(key) : null, stationId: sid, count: items.length, items };
}

async function frequency({ line = null } = {}) {
  const key = normalizeLineKey(line);
  const systems = key === "C" ? ["KLRT"] : key ? ["KRTC"] : ["KRTC", "KLRT"];
  const items = [];
  for (const sys of systems) {
    const res = await fetchFrequency(sys);
    if (!res.ok) {
      return { ok: true, line: key ? lineMeta(key) : null, count: 0, items: [], note: "TDX Frequency 無法取得" };
    }
    for (const row of res.data || []) {
      const lineId = String(row.LineID || row.LineId || "");
      const lk =
        lineId.startsWith("R") || lineId === "R"
          ? "R"
          : lineId.startsWith("O") || lineId === "O"
            ? "O"
            : sys === "KLRT"
              ? "C"
              : null;
      if (key && lk !== key) continue;
      const headways = Array.isArray(row.Headways) && row.Headways.length ? row.Headways : [row];
      for (const h of headways) {
        items.push({
          lineId,
          lineKey: lk,
          routeId: row.RouteID || null,
          direction: row.Direction != null ? Number(row.Direction) : null,
          serviceDay: row.ServiceDay || h.ServiceDay || null,
          peakHeadwayMins: h.PeakHeadway != null ? Number(h.PeakHeadway) : null,
          offPeakHeadwayMins: h.OffPeakHeadway != null ? Number(h.OffPeakHeadway) : null,
          startTime: h.StartTime || row.StartTime || null,
          endTime: h.EndTime || row.EndTime || null,
          system: sys,
        });
      }
    }
  }
  return { ok: true, line: key ? lineMeta(key) : null, count: items.length, items };
}

async function stationTimetable({ line = null, stationId = null } = {}) {
  const key = normalizeLineKey(line);
  const sid = stationId ? String(stationId).trim().toUpperCase() : null;
  if (!sid) {
    return { ok: false, reason: "missing-stationId", hint: "請帶 stationId（如 R11）" };
  }
  const sys = stationLineOf(sid) === "C" ? "KLRT" : "KRTC";
  const res = await fetchStationTimeTable(sys);
  if (!res.ok) {
    return {
      ok: true,
      stationId: sid,
      line: key ? lineMeta(key) : lineMeta(stationLineOf(sid)),
      count: 0,
      items: [],
      note: "TDX StationTimeTable 無法取得",
    };
  }
  const trips = [];
  for (const row of res.data || []) {
    const id = String(row.StationID || "");
    if (id !== sid) continue;
    const lk = stationLineOf(id);
    if (key && lk !== key) continue;
    const tables = row.Timetables || row.StationTimetables || null;
    if (Array.isArray(tables) && tables.length) {
      for (const t of tables) {
        trips.push({
          stationId: id,
          stationName: zhOf(row.StationName) || id,
          lineKey: lk,
          direction: t.Direction != null ? Number(t.Direction) : row.Direction != null ? Number(row.Direction) : null,
          destinationStationId: t.DestinationStationID || row.DestinationStationID || null,
          destinationName: zhOf(t.DestinationStationName) || zhOf(row.DestinationStationName),
          arrivalTime: t.ArrivalTime || null,
          departureTime: t.DepartureTime || t.ArrivalTime || null,
          trainType: t.TrainType || row.TrainType || null,
          serviceDay: t.ServiceDay || row.ServiceDay || null,
        });
      }
    } else {
      trips.push({
        stationId: id,
        stationName: zhOf(row.StationName) || id,
        lineKey: lk,
        direction: row.Direction != null ? Number(row.Direction) : null,
        destinationStationId: row.DestinationStationID || null,
        destinationName: zhOf(row.DestinationStationName),
        arrivalTime: row.ArrivalTime || null,
        departureTime: row.DepartureTime || row.ArrivalTime || null,
        trainType: row.TrainType || null,
        serviceDay: row.ServiceDay || null,
      });
    }
  }
  trips.sort((a, b) => String(a.departureTime || "").localeCompare(String(b.departureTime || "")));
  return {
    ok: true,
    stationId: sid,
    line: key ? lineMeta(key) : lineMeta(stationLineOf(sid)),
    count: trips.length,
    items: trips,
  };
}

async function upcomingDepartures({ line = null, stationId = null } = {}) {
  const key = normalizeLineKey(line);
  const sid = stationId ? String(stationId).trim().toUpperCase() : null;
  if (!sid) {
    return { ok: false, reason: "missing-stationId", hint: "需要 stationId，例如 R7" };
  }

  const now = taiwanNowParts();
  const items = [];

  const live = await liveBoard({ line: key, stationId: sid });
  if (live.ok && Array.isArray(live.items)) {
    for (const row of live.items) {
      let dep = null;
      let estMin = row.estimateMinutes;
      if (row.estimateTime === 0 || estMin === 0) {
        dep = now.hhmm;
        estMin = 0;
      } else if (estMin != null && Number.isFinite(estMin)) {
        dep = hhmmAdd(now.hhmm, estMin);
      }
      items.push({
        departureTime: dep,
        destinationName: row.destinationName || row.tripHeadSign || null,
        direction: row.direction,
        estimateMinutes: estMin,
        source: "live",
        stationId: sid,
        lineKey: row.lineKey || key,
      });
    }
  }

  const fl = await firstLastTrain({ line: key, stationId: sid });
  const hasLive = items.some((x) => x.source === "live");
  if (!hasLive && fl.ok && Array.isArray(fl.items)) {
    for (const row of fl.items) {
      for (const [label, t] of [
        ["first", row.firstTrainTimeRaw || row.firstTrainTime],
        ["last", row.lastTrainTimeRaw || row.lastTrainTime],
      ]) {
        if (!t) continue;
        const tm = minutesOf(t);
        if (tm == null) continue;
        if (label === "last" && tm < now.minutes - 5 && tm < 24 * 60) continue;
        const t5 = normalizeClock(t);
        if (items.some((x) => x.departureTime === t5 && x.destinationName === row.destinationName)) continue;
        items.push({
          departureTime: t5,
          destinationName: row.destinationName || (label === "first" ? "首班" : "末班"),
          direction: row.direction,
          estimateMinutes: tm >= now.minutes && tm < 24 * 60 ? tm - now.minutes : null,
          source: label === "first" ? "first-train" : "last-train",
          stationId: sid,
          lineKey: row.lineKey || key,
        });
      }
    }
  }

  if (!items.some((x) => x.source === "live")) {
    const freq = await frequency({ line: key || stationLineOf(sid) });
    let headway = 8;
    if (freq.ok && freq.items && freq.items.length) {
      const h = freq.items.find((x) => x.offPeakHeadwayMins || x.peakHeadwayMins) || freq.items[0];
      const peak =
        (now.minutes >= 7 * 60 && now.minutes <= 9 * 60) ||
        (now.minutes >= 17 * 60 && now.minutes <= 19 * 60);
      if (peak && h.peakHeadwayMins) headway = h.peakHeadwayMins;
      else if (h.offPeakHeadwayMins) headway = h.offPeakHeadwayMins;
      else if (h.peakHeadwayMins) headway = h.peakHeadwayMins;
    }
    for (let i = 1; i <= 4; i++) {
      items.push({
        departureTime: hhmmAdd(now.hhmm, headway * i),
        destinationName: null,
        direction: null,
        estimateMinutes: headway * i,
        source: "frequency-estimate",
        stationId: sid,
        lineKey: key || stationLineOf(sid),
        note: `依班距約 ${headway} 分鐘推估`,
      });
    }
  }

  items.sort((a, b) => {
    const ma = minutesOf(a.departureTime);
    const mb = minutesOf(b.departureTime);
    if (ma == null && mb == null) return 0;
    if (ma == null) return 1;
    if (mb == null) return -1;
    const aa = ma < now.minutes - 30 ? ma + 24 * 60 : ma;
    const bb = mb < now.minutes - 30 ? mb + 24 * 60 : mb;
    return aa - bb;
  });

  return {
    ok: true,
    stationId: sid,
    line: key ? lineMeta(key) : lineMeta(stationLineOf(sid)),
    now: now.hhmm,
    count: items.length,
    items,
    firstLast: fl.ok ? fl.items : [],
    updatedAt: new Date().toISOString(),
  };
}

async function timetableSummary({ line = null, stationId = null } = {}) {
  const sid = stationId ? String(stationId).trim().toUpperCase() : null;
  if (sid) {
    const up = await upcomingDepartures({ line, stationId: sid });
    const freq = await frequency({ line: line || stationLineOf(sid) }).catch(() => ({ items: [] }));
    return {
      ok: true,
      line: up.line || null,
      stationId: sid,
      now: up.now,
      count: up.count,
      items: up.items || [],
      firstLast: up.firstLast || [],
      frequency: freq.items || [],
      updatedAt: up.updatedAt,
    };
  }
  const [fl, freq] = await Promise.all([
    firstLastTrain({ line, stationId }).catch((e) => ({ ok: true, items: [] })),
    frequency({ line }).catch((e) => ({ ok: true, items: [] })),
  ]);
  return {
    ok: true,
    line: line ? lineMeta(normalizeLineKey(line)) : null,
    stationId: null,
    items: [],
    firstLast: fl.items || [],
    frequency: freq.items || [],
    note: "請帶 stationId 以取得接下來發車時刻",
  };
}

async function handleKrtcQuery(query) {
  const q = query || {};
  const type = String(q.type || q.action || "summary").toLowerCase();
  const line = q.line || q.lineId || null;
  const stationId = q.stationId || q.station || null;

  if (type === "lines") return listLines();
  if (type === "stations") return listStations({ line });
  if (type === "sequence" || type === "station-of-line") return stationSequence({ line });
  if (type === "live" || type === "liveboard" || type === "board") return liveBoard({ line, stationId });
  if (type === "timetable" || type === "schedule") return timetableSummary({ line, stationId });
  if (type === "upcoming" || type === "next" || type === "departures") return upcomingDepartures({ line, stationId });
  if (type === "first-last" || type === "firstlast" || type === "first_last") return firstLastTrain({ line, stationId });
  if (type === "frequency" || type === "headway") return frequency({ line });
  if (type === "station-timetable" || type === "station_timetable" || type === "stt") {
    const st = await stationTimetable({ line, stationId });
    if (st.ok && st.count > 0) return st;
    const up = await upcomingDepartures({ line, stationId });
    return Object.assign({}, up, { note: st.note || "無表定逐班，改以即時／班距推估", fallback: true });
  }

  const lines = listLines();
  const cred = getCredentials();
  return {
    ok: true,
    tdxConfigured: cred.configured,
    lines: lines.lines,
    note: lines.note,
    usage: {
      lines: "?type=lines",
      stations: "?type=stations&line=R|O|C",
      sequence: "?type=sequence&line=R",
      live: "?type=live&stationId=R7",
      timetable: "?type=timetable&stationId=R7",
      upcoming: "?type=upcoming&stationId=R7",
      firstLast: "?type=first-last&stationId=R7",
      frequency: "?type=frequency&line=R",
    },
  };
}

module.exports = {
  handleKrtcQuery,
  listLines,
  listStations,
  stationSequence,
  liveBoard,
  firstLastTrain,
  frequency,
  stationTimetable,
  timetableSummary,
  upcomingDepartures,
  getCredentials,
  normalizeLineKey,
};
