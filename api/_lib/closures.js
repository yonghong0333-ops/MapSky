const { handleSuspensionQuery } = require("./school-closure");
const COUNTIES = ["基隆市","臺北市","新北市","桃園市","新竹市","新竹縣","苗栗縣","臺中市","彰化縣","南投縣","雲林縣","嘉義市","嘉義縣","臺南市","高雄市","屏東縣","宜蘭縣","花蓮縣","臺東縣","澎湖縣","金門縣","連江縣"];
function taipeiYmd(offsetDays = 0) {
  const base = new Date();
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" });
  const t = f.format(base);
  if (!offsetDays) return t;
  const [y, m, d] = t.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}
function taipeiHour() {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", hour: "2-digit", hourCycle: "h23" });
  return Number(f.formatToParts(new Date()).find((p) => p.type === "hour").value);
}
function mapDgpaStatus(day) {
  if (!day) return "pending";
  const w = day.work || day.status || "";
  const text = String(day.text || "");
  if (/尚未宣布/.test(text) || w === "unknown" || !w) return "pending";
  if (w === "suspended" || w === "closed") return "closed";
  if (w === "partial" || w === "normal") return "normal";
  if (w === "out_of_alert" || w === "none") return "none";
  if (w === "pending") return "pending";
  return "pending";
}
function paintTier(entry) {
  if (!entry) return "pending";
  const st = entry.status || "pending";
  const districts = entry.districts || {};
  if (Object.values(districts).some((s) => s === "closed")) return "partial";
  if (st === "closed") return "closed";
  if (st === "normal") return "normal";
  if (st === "pending") return "pending";
  if (st === "none") return "none";
  return "pending";
}
function buildSide(suspension, side) {
  const counties = {};
  const mapPaint = {};
  for (const name of COUNTIES) {
    const it = (suspension.items || []).find((x) => x.county === name);
    const day = side === "tomorrow" ? (it && it.tomorrow) || {} : (it && it.today) || {};
    let status = mapDgpaStatus(day);
    const districts = {};
    const rawDist = side === "tomorrow" ? (it && it.districtsTomorrow) || {} : (it && it.districtsToday) || {};
    for (const [dn, ds] of Object.entries(rawDist)) {
      if (ds === "closed" || ds === "suspended" || ds === "partial") districts[dn] = "closed";
      else if (ds === "normal") districts[dn] = "normal";
    }
    if (Object.keys(districts).length && Object.values(districts).some((s) => s === "closed")) {
      if (status === "closed" || status === "pending" || status === "none") status = "normal";
    }
    const entry = {
      status,
      source: "dgpa",
      forDate: side === "tomorrow" ? taipeiYmd(1) : taipeiYmd(0),
      note: status === "pending" ? "尚未宣布" : day.text || null,
    };
    if (Object.keys(districts).length) entry.districts = districts;
    counties[name] = entry;
    mapPaint[name] = paintTier(entry);
  }
  return { counties, mapPaint };
}
async function handleClosuresRequest(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ ok: false, reason: "method-not-allowed" });
  }
  const suspension = await handleSuspensionQuery({ type: "suspension", day: "all" });
  const hour = taipeiHour();
  const today = buildSide(suspension, "today");
  const tomorrow = buildSide(suspension, "tomorrow");
  const updatedAt = new Date().toISOString();
  return res.status(200).json({
    ok: true,
    enabled: Boolean(suspension && suspension.ok),
    forDate: taipeiYmd(0),
    taipeiToday: taipeiYmd(0),
    taipeiTomorrow: taipeiYmd(1),
    updatedAt,
    counties: today.counties,
    mapPaint: today.mapPaint,
    tomorrowCounties: hour >= 18 ? tomorrow.counties : {},
    tomorrowMapPaint: hour >= 18 ? tomorrow.mapPaint : {},
    dgpa: {
      ok: Boolean(suspension && suspension.ok),
      updatedAt: suspension && suspension.updatedAt,
      hasAnySuspension: Boolean(suspension && suspension.hasAnySuspension),
      counties: today.counties,
    },
    scheduleLifecycle: {
      hour,
      afterSix: hour >= 18,
      rule: "尚未宣布=pending灰；分區=partial黃；照常=normal藍僅明確宣布",
    },
  });
}
module.exports = {
  handleClosuresRequest,
  mergeClosures: () => ({ counties: {}, conflicts: [] }),
  buildDgpaInfo: () => ({}),
  mapDgpaStatus,
  loadManual: async () => ({}),
  saveManual: async () => ({ ok: false }),
  paintTier,
  buildMapPaint: (c) => {
    const o = {};
    for (const k of Object.keys(c || {})) o[k] = paintTier(c[k]);
    return o;
  },
};
