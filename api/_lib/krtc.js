/**
 * 高雄捷運／輕軌
 * 線形由 App 本機繪製。這裡只讀 api/_data/krtc-timetable.json，不打 TDX。
 */
const timetableStore = require("./timetable-store");

function loadBundledKrtcCache() {
  return timetableStore.load("krtc");
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
  const nm = `${parts.hour}:${parts.minute}`.match(/^(\d{1,2}):(\d{2})/);
  const nowMin = nm ? Number(nm[1]) * 60 + Number(nm[2]) : 0;
  const items = block.items
    .map((t) => {
      const m = t.departureTime && String(t.departureTime).match(/^(\d{1,2}):(\d{2})/);
      const mins = m ? Number(m[1]) * 60 + Number(m[2]) : null;
      const estimateMinutes = mins != null ? Math.max(0, mins - nowMin) : null;
      const dest = t.destinationName || null;
      const label = estimateMinutes == null ? null : estimateMinutes <= 0 ? "進站中" : `${estimateMinutes} 分鐘`;
      return {
        ...t,
        destinationName: dest,
        headsign: dest ? "往" + dest : null,
        estimateMinutes,
        statusLabel: label,
        waitText: label,
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

function emptyBoard(stationId) {
  return {
    ok: true,
    type: "live",
    source: "github-cache-miss",
    stationId: stationId || null,
    count: 0,
    items: [],
    updatedAt: new Date().toISOString(),
    note: "捷運時刻表快取尚未就緒，每天 05:10 自動更新",
  };
}

function localShape() {
  return {
    ok: true,
    source: "device",
    lines: [],
    stations: [],
    sequences: [],
    stationIds: [],
    note: "線形由 App 本機繪製，後台只提供時刻表",
  };
}

async function handleKrtcQuery(query) {
  const q = query || {};
  const type = String(q.type || q.action || "summary").toLowerCase();
  const sid = q.stationId || q.station || null;

  if (
    type === "timetable" ||
    type === "schedule" ||
    type === "upcoming" ||
    type === "next" ||
    type === "departures" ||
    type === "station-timetable" ||
    type === "station_timetable" ||
    type === "stt" ||
    type === "live" ||
    type === "liveboard" ||
    type === "board"
  ) {
    if (!sid) return emptyBoard(null);
    return krtcUpcomingFromBundle(sid, q.limit) || emptyBoard(sid);
  }

  if (
    type === "lines" ||
    type === "line" ||
    type === "sequence" ||
    type === "station-of-line" ||
    type === "stations" ||
    type === "list" ||
    type === "shape"
  ) {
    return localShape();
  }

  const bundle = loadBundledKrtcCache();
  return {
    ok: true,
    system: "KRTC",
    systemName: "高雄捷運／輕軌",
    source: "github-cache",
    timetableDate: bundle && bundle.date,
    note: "線形由 App 本機繪製。班表：?type=timetable&stationId=R7",
  };
}

module.exports = {
  handleKrtcQuery,
  getCredentials: () => ({ configured: false, clientId: "", clientSecret: "" }),
};
