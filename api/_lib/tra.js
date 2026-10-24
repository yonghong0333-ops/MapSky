/**
 * 臺鐵（TRA）— 站點與當日班表都讀 GitHub 每日快取，不再即時打 TDX。
 */
const fs = require("fs");
const path = require("path");
const tdxShared = require("./tdx-shared");

const FULL_LIMIT = 120;

function loadBundledTraCache() {
  try {
    const p = path.join(__dirname, "..", "_data", "tra-timetable.json");
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (!raw || !raw.stations) return null;
    return raw;
  } catch {
    return null;
  }
}

function loadBundledTraStations() {
  try {
    const p = path.join(__dirname, "..", "_data", "tra-stations.json");
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (!raw || !Array.isArray(raw.stations)) return null;
    return raw;
  } catch {
    return null;
  }
}

function toHhMm(val) {
  if (val == null || val === "") return null;
  const s = String(val).trim();
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  if (s.includes("T") || /^\d{4}-/.test(s)) {
    try {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        const fmt = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Taipei",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        return fmt.format(d);
      }
    } catch (_) {}
  }
  return null;
}

function upcomingFromBundle(stationId, limit) {
  const bundle = loadBundledTraCache();
  if (!bundle) return null;
  const sid = String(stationId).trim();
  const block = bundle.stations[sid];
  if (!block || !Array.isArray(block.trains) || !block.trains.length) return null;
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
  const items = block.trains
    .map((t) => {
      const dep = toHhMm(t.departureTime);
      const m = dep && dep.match(/^(\d{1,2}):(\d{2})/);
      const mins = m ? Number(m[1]) * 60 + Number(m[2]) : null;
      const estimateMinutes = mins != null ? mins - nowMin : null;
      return {
        trainNo: t.trainNo,
        trainType: t.trainType,
        direction: t.direction,
        departureTime: dep,
        scheduledTime: dep,
        time: dep,
        destinationName: t.destinationName,
        endingStationName: t.destinationName,
        startingStationName: t.startingStationName,
        estimateMinutes,
        headsign: t.destinationName ? "往" + t.destinationName : null,
        statusLabel:
          estimateMinutes == null
            ? null
            : estimateMinutes <= 0
              ? "即將發車"
              : `${estimateMinutes} 分鐘`,
        delayMinutes: 0,
      };
    })
    .filter((t) => t.estimateMinutes == null || t.estimateMinutes >= 0)
    .slice(0, Math.min(FULL_LIMIT, Number(limit) || FULL_LIMIT));
  return {
    ok: true,
    cached: true,
    source: "github-cache",
    stationId: sid,
    date: bundle.date,
    count: items.length,
    items,
    trains: items,
    updatedAt: bundle.updatedAt,
    note: "當日剩餘班表（GitHub 每日快取）",
  };
}

function getCredentials() {
  return tdxShared.getCredentials();
}

async function listStations({ q } = {}) {
  const bundle = loadBundledTraStations();
  let stations = bundle ? bundle.stations.slice() : [];
  if (q) {
    const k = String(q).toLowerCase();
    stations = stations.filter(
      (s) =>
        (s.nameZh && s.nameZh.includes(q)) ||
        (s.nameEn && String(s.nameEn).toLowerCase().includes(k)) ||
        String(s.stationId).includes(q)
    );
  }
  return {
    ok: true,
    cached: true,
    source: "github-cache",
    count: stations.length,
    stations,
    updatedAt: bundle && bundle.updatedAt,
    note: bundle ? "站點來自 GitHub 每日快取" : "站點快取尚未就緒，等下一次每日更新",
  };
}

async function listLines() {
  return { ok: true, cached: true, source: "github-cache", lines: [] };
}

async function stationLiveBoard({ stationId } = {}) {
  if (!stationId) {
    return { ok: false, reason: "missing-stationId", hint: "請帶 stationId，例如 4400（高雄）" };
  }
  const sid = String(stationId).trim();
  const full = upcomingFromBundle(sid, FULL_LIMIT);
  if (full && full.count) return full;
  return {
    ok: true,
    cached: true,
    source: "github-cache-miss",
    stationId: sid,
    count: 0,
    items: [],
    trains: [],
    updatedAt: new Date().toISOString(),
    note: "台鐵日班表快取尚未就緒，每天 05:10 自動更新",
  };
}

async function trainLiveBoard() {
  return { ok: true, cached: true, source: "github-cache", count: 0, trains: [] };
}

async function alerts() {
  return { ok: true, cached: true, source: "github-cache", count: 0, alerts: [] };
}

async function handleTraQuery(query) {
  const q = query || {};
  const type = String(q.type || q.action || "summary").toLowerCase();
  if (type === "stations" || type === "list") {
    return listStations({ q: q.q || q.keyword || q.name });
  }
  if (type === "lines") return listLines();
  if (["timetable", "station-timetable", "upcoming", "next", "departures", "live", "liveboard", "board"].includes(type)) {
    return stationLiveBoard({ stationId: q.stationId || q.station || null });
  }
  if (type === "train" || type === "train-live") return trainLiveBoard();
  if (type === "alert" || type === "alerts") return alerts();
  const cred = getCredentials();
  return {
    ok: true,
    tdxConfigured: cred.configured,
    system: "TRA",
    systemName: "臺灣鐵路",
    source: "github-cache",
    usage: {
      stations: "?type=stations",
      timetable: "?type=timetable&stationId=3340",
    },
  };
}

module.exports = {
  handleTraQuery,
  listStations,
  listLines,
  stationLiveBoard,
  trainLiveBoard,
  alerts,
  getCredentials,
};
