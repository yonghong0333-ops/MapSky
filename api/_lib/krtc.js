/**
 * krtc loader
 * - live / timetable：優先 GitHub 當日站表快取 api/_data/krtc-timetable.json
 * - 再退回 TDX LiveBoard / StationTimeTable
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

function loadBundledKrtcCache() {
  try {
    const p = path.join(__dirname, "..", "_data", "krtc-timetable.json");
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (!raw || !raw.stations) return null;
    return raw;
  } catch {
    return null;
  }
}

function krtcUpcomingFromBundle(stationId, limit) {
  const bundle = loadBundledKrtcCache();
  if (!bundle) return null;
  const sid = String(stationId || "").trim().toUpperCase();
  const block = bundle.stations[sid];
  if (!block || !Array.isArray(block.items) || !block.items.length) return null;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const now = `${parts.hour}:${parts.minute}`;
  const nm = now.match(/^(\d{1,2}):(\d{2})/);
  const nowMin = nm ? Number(nm[1]) * 60 + Number(nm[2]) : 0;
  const items = block.items
    .map((t) => {
      const m = t.departureTime && String(t.departureTime).match(/^(\d{1,2}):(\d{2})/);
      const mins = m ? Number(m[1]) * 60 + Number(m[2]) : null;
      const estimateMinutes = mins != null ? Math.max(0, mins - nowMin) : null;
      const dest = t.destinationName || null;
      return {
        ...t,
        destinationName: dest,
        headsign: dest ? "往" + dest : null,
        estimateMinutes,
        statusLabel:
          estimateMinutes == null ? null : estimateMinutes <= 0 ? "進站中" : `${estimateMinutes} 分鐘`,
        waitText:
          estimateMinutes == null ? null : estimateMinutes <= 0 ? "進站中" : `${estimateMinutes} 分鐘`,
      };
    })
    .filter((t) => t.estimateMinutes == null || t.estimateMinutes >= 0)
    .slice(0, Math.min(40, Number(limit) || 12));
  return {
    ok: true,
    type: "live",
    source: "github-cache",
    stationId: sid,
    date: bundle.date,
    count: items.length,
    items,
    updatedAt: bundle.updatedAt,
    note: "使用 GitHub 當日時刻表快取",
  };
}

let cached = null;
let loading = null;

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
        : "順行／逆行共軌，地圖請只畫 mapPolyline 一條。",
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

async function listLinesWithShape(mod) {
  const base = typeof mod.listLines === "function" ? await mod.listLines() : { ok: true, lines: [] };
  return {
    ...base,
    note: "geometry 為 TDX Shape WKT。無 geometry 時請用 mapPolyline。",
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
    const sid = q.stationId || q.station || null;
    if (sid) {
      const bundled = krtcUpcomingFromBundle(sid, q.limit);
      if (bundled && bundled.count) return bundled;
    }
    return buildUpcoming(mod, q);
  }

  if (type === "lines" || type === "line") {
    return listLinesWithShape(mod);
  }

  if (type === "sequence" || type === "station-of-line") {
    const seq = await mod.stationSequence({ line: q.line || q.lineId || null });
    return simplifySequenceForMap(seq);
  }

  if (type === "live" || type === "liveboard" || type === "board") {
    const sid = q.stationId || q.station || null;
    let r = null;
    try {
      r = await mod.liveBoard({
        line: q.line || q.lineId || null,
        stationId: sid,
      });
      if (r && r.ok && Array.isArray(r.items)) {
        r.items = enrichLiveItems(r.items);
      }
    } catch (_) {
      r = null;
    }
    if (!r || !r.ok || !r.items || !r.items.length) {
      const bundled = sid ? krtcUpcomingFromBundle(sid, q.limit) : null;
      if (bundled && bundled.count) return bundled;
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
