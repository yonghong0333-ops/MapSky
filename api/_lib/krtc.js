/**
 * 高雄捷運 / 輕軌（TDX）
 * - KRTC：紅線(R)、橘線(O)
 * - KLRT：環狀輕軌（常被誤稱綠線；高雄捷運本體無綠線）
 *
 * 環境變數：TDX_CLIENT_ID、TDX_CLIENT_SECRET
 * 申請：https://tdx.transportdata.tw/
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const TOKEN_URL =
  "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const API_BASE = "https://tdx.transportdata.tw/api/basic/v2/Rail/Metro";

const CACHE_TTL_STATIC_MS = 6 * 60 * 60 * 1000; // 站點／路線 6 小時
const CACHE_TTL_LIVE_MS = 20 * 1000; // 即時看板 20 秒
const TOKEN_SKEW_MS = 60 * 1000;

let memoryToken = null; // { access_token, expiresAt }

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
  const data = await resp.json();
  return { ok: true, data };
}

/** 正規化路線參數：R/紅線、O/橘線、C|G|LRT/輕軌 */
function normalizeLineKey(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().toUpperCase();
  if (s === "R" || s === "RED" || s.includes("紅")) return "R";
  if (s === "O" || s === "ORANGE" || s.includes("橘") || s.includes("橙")) return "O";
  if (s === "G" || s === "GREEN" || s === "C" || s === "LRT" || s.includes("綠") || s.includes("輕軌") || s.includes("環狀")) {
    return "C"; // 輕軌站碼多為 C1…
  }
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
  if (key === "R") {
    return {
      lineKey: "R",
      lineId: "R",
      nameZh: "紅線",
      nameEn: "Red Line",
      color: "#e3002c",
      system: "KRTC",
      systemName: "高雄捷運",
    };
  }
  if (key === "O") {
    return {
      lineKey: "O",
      lineId: "O",
      nameZh: "橘線",
      nameEn: "Orange Line",
      color: "#f7a600",
      system: "KRTC",
      systemName: "高雄捷運",
    };
  }
  if (key === "C") {
    return {
      lineKey: "C",
      lineId: "C",
      nameZh: "環狀輕軌",
      nameEn: "Circular Light Rail",
      color: "#00a19b",
      system: "KLRT",
      systemName: "高雄輕軌",
      note: "高雄捷運本體無「綠線」；此為環狀輕軌（若前端以綠線指輕軌可對應此線）",
    };
  }
  return null;
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

function mapStation(s, lineKey) {
  const id = s.StationID || s.StationId;
  return {
    stationId: id,
    nameZh: (s.StationName && (s.StationName.Zh_tw || s.StationName.Zh)) || s.StationName || id,
    nameEn: (s.StationName && s.StationName.En) || null,
    lineKey: lineKey || stationLineOf(id),
    lat: s.StationPosition && (s.StationPosition.PositionLat || s.StationPosition.lat),
    lon: s.StationPosition && (s.StationPosition.PositionLon || s.StationPosition.lon),
    address: s.StationAddress || null,
  };
}

function mapLive(row) {
  return {
    stationId: row.StationID,
    stationName: (row.StationName && (row.StationName.Zh_tw || row.StationName.Zh)) || row.StationName || null,
    tripHeadSign: row.TripHeadSign || null,
    destinationName:
      (row.DestinationName && (row.DestinationName.Zh_tw || row.DestinationName.Zh)) ||
      row.DestinationStationName ||
      null,
    estimateTime: row.EstimateTime != null ? Number(row.EstimateTime) : null, // 秒；0=進站
    estimateMinutes:
      row.EstimateTime != null && Number.isFinite(Number(row.EstimateTime))
        ? Math.max(0, Math.round(Number(row.EstimateTime) / 60))
        : null,
    direction: row.Direction != null ? Number(row.Direction) : null,
    srcUpdateTime: row.SrcUpdateTime || row.UpdateTime || null,
  };
}

/** 路線列表（紅／橘／輕軌） */
function listLines() {
  return {
    ok: true,
    lines: [lineMeta("R"), lineMeta("O"), lineMeta("C")],
    note: "高雄捷運正式路線為紅線、橘線；無官方「綠線」。前端若稱綠線，請對應環狀輕軌(C)。",
  };
}

/** 站點清單，可依 line 過濾 */
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
      stations.push({ ...mapped, system: sys });
    }
  }
  stations.sort((a, b) => String(a.stationId).localeCompare(String(b.stationId)));
  return {
    ok: true,
    line: key ? lineMeta(key) : null,
    count: stations.length,
    stations,
  };
}

/** 某線站序 */
async function stationSequence({ line } = {}) {
  const key = normalizeLineKey(line) || "R";
  const meta = lineMeta(key);
  if (!meta) return { ok: false, reason: "bad-line" };
  const system = meta.system;
  const res = await fetchStationOfLine(system);
  if (!res.ok) return res;

  // StationOfLine：各 Direction 的 Stations[]
  const sequences = [];
  for (const route of res.data || []) {
    const lineId = String(route.LineID || route.LineId || "");
    // KRTC 紅線 LineID 可能為 R 或含 R；輕軌可能不同
    const match =
      key === "R"
        ? lineId === "R" || lineId.startsWith("R")
        : key === "O"
          ? lineId === "O" || lineId.startsWith("O")
          : true; // KLRT 全收
    if (key !== "C" && !match) continue;
    const stops = (route.Stations || []).map((st, i) => ({
      sequence: st.Sequence != null ? st.Sequence : i + 1,
      stationId: st.StationID,
      nameZh: (st.StationName && (st.StationName.Zh_tw || st.StationName.Zh)) || st.StationName,
      nameEn: (st.StationName && st.StationName.En) || null,
    }));
    sequences.push({
      lineId,
      direction: route.Direction != null ? Number(route.Direction) : null,
      stops,
    });
  }
  return { ok: true, line: meta, sequences };
}

/** 即時到站看板 */
async function liveBoard({ line = null, stationId = null } = {}) {
  const key = normalizeLineKey(line);
  const sid = stationId ? String(stationId).trim().toUpperCase() : null;
  const systems = [];
  if (sid) {
    const lk = stationLineOf(sid);
    systems.push(lk === "C" ? "KLRT" : "KRTC");
  } else if (key === "C") systems.push("KLRT");
  else if (key === "R" || key === "O") systems.push("KRTC");
  else systems.push("KRTC", "KLRT");

  const boards = [];
  for (const sys of systems) {
    const res = await fetchLiveBoard(sys);
    if (!res.ok) return res;
    for (const row of res.data) {
      const id = String(row.StationID || "");
      if (sid && id !== sid) continue;
      const lk = stationLineOf(id);
      if (key && lk !== key) continue;
      boards.push({ ...mapLive(row), lineKey: lk, system: sys });
    }
  }
  boards.sort((a, b) => {
    const ea = a.estimateTime == null ? 1e12 : a.estimateTime;
    const eb = b.estimateTime == null ? 1e12 : b.estimateTime;
    return ea - eb;
  });
  return {
    ok: true,
    line: key ? lineMeta(key) : null,
    stationId: sid,
    count: boards.length,
    items: boards,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 統一入口
 * type: lines | stations | sequence | live | summary
 */
async function handleKrtcQuery(query) {
  const q = query || {};
  const type = String(q.type || q.action || "summary").toLowerCase();
  const line = q.line || q.lineId || null;
  const stationId = q.stationId || q.station || null;

  if (type === "lines") return listLines();
  if (type === "stations") return listStations({ line });
  if (type === "sequence" || type === "station-of-line") return stationSequence({ line });
  if (type === "live" || type === "liveboard" || type === "board") {
    return liveBoard({ line, stationId });
  }

  // summary：三線資訊 + 可選即時摘要
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
      live: "?type=live&line=R 或 &stationId=R11",
    },
  };
}

module.exports = {
  handleKrtcQuery,
  listLines,
  listStations,
  stationSequence,
  liveBoard,
  getCredentials,
  normalizeLineKey,
};
