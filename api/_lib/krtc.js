/**
 * krtc loader
 * - 即時：補分鐘／進站中
 * - 接下來發車：優先 TDX StationTimeTable（對齊官網），沒有才班距推估
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

function weekdayServiceOk(serviceDay) {
  // ServiceDay 可能是物件 {Monday:true,...} 或略過
  if (!serviceDay || typeof serviceDay !== "object") return true;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const d = new Date();
  // 台灣時區星期
  const tw = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const name = days[tw.getDay()];
  if (serviceDay[name] === false) return false;
  if (serviceDay[name] === true) return true;
  // 有些用 0/1
  if (serviceDay[name] === 0) return false;
  return true;
}

/** 從 StationTimeTable 結果抽出「現在之後」的班次 */
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
    // 只取現在起 3 小時內（含稍早 1 分）
    if (tm < nowMin - 1) continue;
    if (tm > nowMin + 180) continue;

    let name = (row.destinationName || "").trim();
    if (!name) {
      // 用 direction 對終點
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
  for (const [name, list] of byDest.entries()) {
    list.sort((a, b) => minutesOf(a.departureTime) - minutesOf(b.departureTime));
    // 去重同一分鐘
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

  // 1) 真實站別時刻表
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
      note: "依 TDX 站別時刻表（與官網班表同源結構）",
    };
  }

  // 2) fallback：原本 live + 班距
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
    note: (st && st.note) || "TDX 站別時刻表無資料，改以即時／班距推估（可能與官網不完全一致）",
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

  const result = await mod.handleKrtcQuery(query);

  if ((type === "live" || type === "liveboard" || type === "board") && result && result.ok && Array.isArray(result.items)) {
    result.items = enrichLiveItems(result.items);
  }

  return result;
}

module.exports = {
  handleKrtcQuery,
  listLines: async (...a) => (await loadRemote()).listLines(...a),
  listStations: async (...a) => (await loadRemote()).listStations(...a),
  stationSequence: async (...a) => (await loadRemote()).stationSequence(...a),
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
