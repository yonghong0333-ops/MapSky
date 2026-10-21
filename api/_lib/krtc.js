/**
 * krtc loader + 終點站名 + 後續班次展開
 * 核心邏輯從 fa4291 載入；timetable/upcoming 補 destinationName，並依班距補多個時刻
 */
const https = require("https");

let cached = null;
let loading = null;

const LINE_TERMINALS = {
  R: ["岡山車站", "小港"],
  O: ["哈瑪星", "大寮"],
  C: ["旅運中心", "前鎮之星"],
};

// 預設尖峰／離峰班距（分鐘），TDX Frequency 抓不到時用
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
  return Number(m[1]) * 60 + Number(m[2]);
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

function collectDestinations(result) {
  const set = new Map();
  const add = (name, direction) => {
    const n = (name || "").trim();
    if (!n || n === "一" || n === "-") return;
    const key = n + "|" + (direction == null ? "" : String(direction));
    if (!set.has(key)) set.set(key, { destinationName: n, direction: direction == null ? null : Number(direction) });
  };
  for (const it of result.items || []) {
    add(it.destinationName || it.tripHeadSign, it.direction);
  }
  for (const it of result.firstLast || []) {
    add(it.destinationName, it.direction);
  }
  return [...set.values()];
}

function pickHeadway(result, lk) {
  // 從 frequency 欄位試著讀
  const freqs = result.frequency || [];
  for (const f of freqs) {
    const off = f.offPeakHeadwayMins || f.OffPeakHeadway;
    const peak = f.peakHeadwayMins || f.PeakHeadway;
    if (off || peak) return Number(off || peak);
  }
  return DEFAULT_HEADWAY[lk] || 8;
}

/**
 * 每個終點至少要有若干個「接下來」時刻：
 * - 以 live 的當班為第一筆（可為進站中）
 * - 再依班距往後推 3～4 班
 */
function enrichUpcoming(result, stationId) {
  if (!result || !result.ok) return result;
  const rawItems = Array.isArray(result.items) ? result.items : [];
  const lk = lineKeyOfStation(stationId) || (result.line && result.line.lineKey) || null;
  let dests = collectDestinations(result);

  if (!dests.length && lk && LINE_TERMINALS[lk]) {
    dests = LINE_TERMINALS[lk].map((name, i) => ({ destinationName: name, direction: i }));
  }

  // 先把既有 item 補好站名
  const fixed = rawItems.map((it, idx) => {
    let name = (it.destinationName || it.tripHeadSign || "").trim();
    if (!name || name === "一" || name === "-") {
      if (dests.length === 1) name = dests[0].destinationName;
      else if (dests.length > 1) {
        const byDir = dests.find((d) => d.direction != null && d.direction === it.direction);
        name = (byDir || dests[idx % dests.length]).destinationName;
      } else name = null;
    }
    return {
      ...it,
      destinationName: name,
      headsign: name ? "往" + name : null,
    };
  });

  const headway = pickHeadway(result, lk);
  const now = result.now || taiwanNowHHMM();
  const slotsPerDest = 4; // 每個方向顯示幾個時刻

  // 依終點分組，取該方向最早一班當基準
  const byDest = new Map();
  for (const it of fixed) {
    const name = it.destinationName;
    if (!name) continue;
    if (!byDest.has(name)) byDest.set(name, []);
    byDest.get(name).push(it);
  }

  // 若 live 完全沒終點，用 dests 建空組
  if (byDest.size === 0 && dests.length) {
    for (const d of dests) byDest.set(d.destinationName, []);
  }

  const expanded = [];
  for (const [name, list] of byDest.entries()) {
    // 基準時間：live 最早一班，否則現在
    list.sort((a, b) => (minutesOf(a.departureTime) ?? 1e9) - (minutesOf(b.departureTime) ?? 1e9));
    let base = list[0] && list[0].departureTime ? list[0].departureTime : now;
    const dir = list[0] && list[0].direction != null ? list[0].direction : (dests.find((d) => d.destinationName === name) || {}).direction;

    // 若基準是「現在／進站中」，下一班從 headway 後開始多推；進站那班仍保留
    const times = new Set();
    if (list[0] && list[0].departureTime) times.add(list[0].departureTime);

    // 從 base 往後依班距推
    let t = base;
    // 若第一筆就是現在，從下一班開始補
    const baseMin = minutesOf(base);
    const nowMin = minutesOf(now);
    let startOffset = 0;
    if (baseMin != null && nowMin != null && Math.abs(baseMin - nowMin) <= 1) {
      // 進站中／即將到：保留當班，後續從 +headway 開始
      startOffset = headway;
    }
    for (let i = 0; i < slotsPerDest + 2; i++) {
      const add = startOffset + headway * i;
      if (add === 0 && times.size) continue;
      const next = hhmmAdd(base, add === 0 ? headway : add);
      if (next) times.add(next);
      if (times.size >= slotsPerDest) break;
    }

    // 若 list 裡已有其他 live 時刻也併入
    for (const it of list) {
      if (it.departureTime) times.add(it.departureTime);
    }

    const sorted = [...times].sort((a, b) => (minutesOf(a) ?? 0) - (minutesOf(b) ?? 0));
    // 只留「現在起」附近的 slotsPerDest 個
    const upcoming = sorted
      .filter((t) => {
        const m = minutesOf(t);
        if (m == null || nowMin == null) return true;
        // 允許現在前後 1 分鐘（進站中）
        return m >= nowMin - 1 || m < 5; // 跨日凌晨另議，先簡化
      })
      .slice(0, slotsPerDest);

    for (const t of upcoming) {
      const est = minutesOf(t) != null && nowMin != null ? Math.max(0, minutesOf(t) - nowMin) : null;
      expanded.push({
        departureTime: t,
        destinationName: name,
        direction: dir != null ? dir : null,
        estimateMinutes: est,
        source: list[0] && list[0].source === "live" && t === list[0].departureTime ? "live" : "frequency-estimate",
        stationId: stationId || null,
        lineKey: lk,
        headsign: "往" + name,
      });
    }
  }

  // 排序：先終點名，再時間
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
  };
}

async function handleKrtcQuery(query) {
  const mod = await loadRemote();
  const q = query || {};
  const type = String(q.type || q.action || "summary").toLowerCase();
  const stationId = q.stationId || q.station || null;
  const result = await mod.handleKrtcQuery(query);

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
    return enrichUpcoming(result, stationId);
  }

  if ((type === "live" || type === "liveboard" || type === "board") && result && result.ok && Array.isArray(result.items)) {
    result.items = result.items.map((it) => {
      const name = (it.destinationName || it.tripHeadSign || "").trim() || null;
      return { ...it, destinationName: name, headsign: name ? "往" + name : null };
    });
  }

  return result;
}

module.exports = {
  handleKrtcQuery,
  listLines: async (...a) => (await loadRemote()).listLines(...a),
  listStations: async (...a) => (await loadRemote()).listStations(...a),
  stationSequence: async (...a) => (await loadRemote()).stationSequence(...a),
  liveBoard: async (...a) => (await loadRemote()).liveBoard(...a),
  firstLastTrain: async (...a) => (await loadRemote()).firstLastTrain(...a),
  frequency: async (...a) => (await loadRemote()).frequency(...a),
  stationTimetable: async (...a) => (await loadRemote()).stationTimetable(...a),
  timetableSummary: async (...a) => {
    const mod = await loadRemote();
    const r = await mod.timetableSummary(...a);
    const sid = (a[0] && a[0].stationId) || null;
    return enrichUpcoming(r, sid);
  },
  upcomingDepartures: async (...a) => {
    const mod = await loadRemote();
    const r = await mod.upcomingDepartures(...a);
    const sid = (a[0] && a[0].stationId) || null;
    return enrichUpcoming(r, sid);
  },
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
