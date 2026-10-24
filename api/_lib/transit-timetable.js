/**
 * 統一的班表入口：GET /api/transit/timetable?system=thsr|tra|krtc&stationId=...
 *   - 不帶 system（或 type=status）：回三個系統的班表是哪天的、有沒有過期 → 用來確認每日抓取有沒有跑
 *   - 帶 system + stationId：回該站今天剩下的班次
 * 資料全部來自每日快取（timetable-store），不打 TDX。路線與車站由 App 本機繪製，這裡不提供。
 */
const store = require("./timetable-store");
const { handleThsrQuery } = require("./thsr-impl");
const { handleTraQuery } = require("./tra");
const { handleKrtcQuery } = require("./krtc");

const ALIAS = {
  thsr: "thsr", hsr: "thsr", 高鐵: "thsr",
  tra: "tra", rail: "tra", "taiwan-rail": "tra", 臺鐵: "tra", 台鐵: "tra",
  krtc: "krtc", metro: "krtc", "kaohsiung-mrt": "krtc", 捷運: "krtc", 高雄捷運: "krtc",
};

async function handleTimetableQuery(query) {
  const q = query || {};
  const type = String(q.type || "").toLowerCase();
  const system = ALIAS[String(q.system || "").trim().toLowerCase()] || ALIAS[String(q.system || "").trim()];
  if (type === "status" || !q.system) {
    return { ok: true, source: "github-cache", ...store.status() };
  }
  if (!system) {
    return { ok: false, reason: "bad-system", hint: "system 請填 thsr、tra 或 krtc" };
  }
  const stationId = q.stationId || q.station || null;
  if (!stationId) {
    return { ok: false, reason: "missing-stationId", hint: "請帶 stationId，例如高鐵 1100、臺鐵 4400、捷運 R10" };
  }
  const sub = { type: "timetable", stationId, limit: q.limit, date: q.date };
  const handler = system === "thsr" ? handleThsrQuery : system === "tra" ? handleTraQuery : handleKrtcQuery;
  const result = await handler(sub);
  return { ...result, system, timetable: store.meta(system) };
}

module.exports = { handleTimetableQuery };
