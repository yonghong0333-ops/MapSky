/**
 * 每日班表快取的唯一讀取點（高鐵／臺鐵／高雄捷運）
 * 資料由 GitHub Actions（refresh-transit，每天一次）寫進 api/_data/*.json。
 * 這裡只負責讀：檔案沒變就不重複解析（捷運那份有好幾 MB），並回報資料是哪天的、是不是過期。
 */
const fs = require("fs");
const path = require("path");

const FILES = {
  thsr: "thsr-timetable.json",
  tra: "tra-timetable.json",
  krtc: "krtc-timetable.json",
};
const memo = {};

function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** 讀整份快取；沒有或壞掉回 null */
function load(system) {
  const file = FILES[system];
  if (!file) return null;
  const p = path.join(__dirname, "..", "_data", file);
  try {
    const st = fs.statSync(p);
    const m = memo[system];
    if (m && m.mtimeMs === st.mtimeMs) return m.raw;
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (!raw || !raw.stations) return null;
    memo[system] = { mtimeMs: st.mtimeMs, raw };
    return raw;
  } catch {
    return null;
  }
}

/** 這份班表是哪天的、有幾站、是不是今天的 */
function meta(system) {
  const raw = load(system);
  if (!raw) return { system, ready: false };
  const stations = Object.keys(raw.stations);
  const withData = stations.filter((k) => {
    const b = raw.stations[k] || {};
    return (b.trains && b.trains.length) || (b.items && b.items.length);
  }).length;
  return {
    system,
    ready: true,
    date: raw.date || null,
    updatedAt: raw.updatedAt || null,
    stale: raw.date !== todayYmd(),
    stations: stations.length,
    stationsWithData: withData,
  };
}

function status() {
  return { today: todayYmd(), systems: Object.keys(FILES).map(meta) };
}

module.exports = { load, meta, status, todayYmd, SYSTEMS: Object.keys(FILES) };
