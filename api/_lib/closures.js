const { handleSuspensionQuery } = require("./school-closure");
const COUNTIES = ["基隆市","臺北市","新北市","桃園市","新竹市","新竹縣","苗栗縣","臺中市","彰化縣","南投縣","雲林縣","嘉義市","嘉義縣","臺南市","高雄市","屏東縣","宜蘭縣","花蓮縣","臺東縣","澎湖縣","金門縣","連江縣"];
function mapDgpaStatus(day) {
  if (!day) return "none";
  const w = day.work || day.status || "none";
  if (w === "suspended" || w === "closed") return "closed";
  if (w === "partial") return "normal";
  if (w === "normal") return "normal";
  if (w === "unknown" || w === "pending") return "pending";
  return "none";
}
function paintTier(entry) {
  if (!entry) return "none";
  const st = entry.status || "none";
  const districts = entry.districts || {};
  if (Object.values(districts).some((s) => s === "closed")) return "partial";
  if (st === "closed") return "closed";
  if (st === "normal") return "normal";
  if (st === "pending") return "pending";
  return "none";
}
async function handleClosuresRequest(req, res) {
  const suspension = await handleSuspensionQuery({ type: "suspension", day: "all" });
  const counties = {};
  const mapPaint = {};
  for (const name of COUNTIES) {
    const it = (suspension.items || []).find((x) => x.county === name);
    const day = (it && it.today) || {};
    let status = mapDgpaStatus(day);
    const districts = {};
    for (const [dn, ds] of Object.entries((it && it.districtsToday) || {})) {
      if (ds === "closed" || ds === "suspended" || ds === "partial") districts[dn] = "closed";
    }
    if (Object.keys(districts).length && status === "closed") status = "normal";
    counties[name] = { status, source: "dgpa", forDate: null, ...(Object.keys(districts).length ? { districts } : {}) };
    mapPaint[name] = paintTier(counties[name]);
  }
  const tomorrowCounties = {};
  const tomorrowMapPaint = {};
  for (const name of COUNTIES) {
    const it = (suspension.items || []).find((x) => x.county === name);
    const day = (it && it.tomorrow) || {};
    let status = mapDgpaStatus(day);
    const districts = {};
    for (const [dn, ds] of Object.entries((it && it.districtsTomorrow) || {})) {
      if (ds === "closed" || ds === "suspended" || ds === "partial") districts[dn] = "closed";
    }
    if (Object.keys(districts).length) {
      if (status === "closed" || status === "pending" || status === "none") status = "normal";
    } else if (!status || status === "none") {
      status = "pending";
    }
    tomorrowCounties[name] = { status, source: "dgpa", forDate: null, note: status === "pending" ? "尚未宣布" : undefined, ...(Object.keys(districts).length ? { districts } : {}) };
    tomorrowMapPaint[name] = paintTier(tomorrowCounties[name]);
  }
  const enabled = Boolean(suspension && suspension.ok);
  return res.status(200).json({
    ok: true,
    enabled,
    counties,
    mapPaint,
    tomorrowCounties,
    tomorrowMapPaint,
    dgpa: { ok: Boolean(suspension && suspension.ok), counties: {} },
    scheduleLifecycle: { afterSix: true, hour: 19 },
    notice: "minimal-restore-mapPaint",
  });
}
module.exports = { handleClosuresRequest, mergeClosures: () => ({ counties: {}, conflicts: [] }), buildDgpaInfo: () => ({}), mapDgpaStatus, loadManual: async () => ({}), saveManual: async () => ({ ok: false }), manualForDate: () => ({}), applyScheduleLifecycle: (m) => ({ manual: m, dirty: false, events: [], today: "", tomorrow: "", hour: 0 }), paintTier, buildMapPaint: (c) => { const o={}; for (const k of Object.keys(c||{})) o[k]=paintTier(c[k]); return o; } };
