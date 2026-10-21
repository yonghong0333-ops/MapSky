/**
 * krtc loader + 終點站名補強
 * 核心邏輯仍從 fa4291 載入；timetable/upcoming 會補上 destinationName
 */
const https = require("https");

let cached = null;
let loading = null;

const LINE_TERMINALS = {
  R: ["岡山車站", "小港"],
  O: ["哈瑪星", "大寮"],
  C: ["旅運中心", "前鎮之星"],
};

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

function enrichUpcoming(result, stationId) {
  if (!result || !result.ok) return result;
  const items = Array.isArray(result.items) ? result.items : [];
  const lk = lineKeyOfStation(stationId) || (result.line && result.line.lineKey) || null;
  let dests = collectDestinations(result);

  // 從 firstLast / live 仍抓不到時，用路線終點站
  if (!dests.length && lk && LINE_TERMINALS[lk]) {
    dests = LINE_TERMINALS[lk].map((name, i) => ({ destinationName: name, direction: i }));
  }

  // 補空的 destinationName
  const fixed = items.map((it, idx) => {
    let name = (it.destinationName || it.tripHeadSign || "").trim();
    if (!name || name === "一" || name === "-") {
      if (dests.length === 1) name = dests[0].destinationName;
      else if (dests.length > 1) {
        // 依 direction 對，否則輪替
        const byDir = dests.find((d) => d.direction != null && d.direction === it.direction);
        name = (byDir || dests[idx % dests.length]).destinationName;
      } else {
        name = null;
      }
    }
    return {
      ...it,
      destinationName: name,
      // 給前端直接顯示用
      headsign: name ? "往" + name : null,
    };
  });

  // 若只有班距推估且沒有依方向拆，幫每個終點各產生一組時段
  const onlyFreq = fixed.length > 0 && fixed.every((x) => x.source === "frequency-estimate");
  if (onlyFreq && dests.length >= 2) {
    const times = fixed.map((x) => x.departureTime).filter(Boolean);
    const expanded = [];
    for (const d of dests) {
      for (const t of times) {
        expanded.push({
          departureTime: t,
          destinationName: d.destinationName,
          direction: d.direction,
          estimateMinutes: null,
          source: "frequency-estimate",
          stationId: stationId || null,
          lineKey: lk,
          headsign: "往" + d.destinationName,
        });
      }
    }
    return { ...result, items: expanded, count: expanded.length };
  }

  return { ...result, items: fixed, count: fixed.length };
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

  // live 也補 headsign，方便前端統一
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
