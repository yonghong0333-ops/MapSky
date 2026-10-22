const { getRedisClient } = require("./redis-client");
const { handleSuspensionQuery } = require("./school-closure");
const { requireAdmin } = require("./require-admin");

const REDIS_KEY = "settings:closures";
const ALLOWED = new Set(["closed", "normal", "none", "pending"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTIES = ["基隆市","臺北市","新北市","桃園市","新竹市","新竹縣","苗栗縣","臺中市","彰化縣","南投縣","雲林縣","嘉義市","嘉義縣","臺南市","高雄市","屏東縣","宜蘭縣","花蓮縣","臺東縣","澎湖縣","金門縣","連江縣"];

function emptyManual() { return { enabled: true, counties: {}, overrides: [], byDate: {}, meta: {} }; }
function taipeiYmd(offsetDays = 0) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" });
  const t = f.format(new Date());
  if (!offsetDays) return t;
  const [y, m, d] = t.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}
function taipeiHour() {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", hour: "2-digit", hourCycle: "h23" });
  return Number(f.formatToParts(new Date()).find((p) => p.type === "hour").value);
}
function normEntry(c) {
  if (!c || typeof c !== "object" || !ALLOWED.has(c.status)) return null;
  const out = { status: c.status };
  if (c.districts && typeof c.districts === "object") {
    const d = {}; for (const [k, v] of Object.entries(c.districts)) if (ALLOWED.has(v)) d[k] = v;
    if (Object.keys(d).length) out.districts = d;
  }
  if (c.forDate && DATE_RE.test(String(c.forDate))) out.forDate = String(c.forDate);
  if (c.status === "pending" && c.announceAt) out.announceAt = String(c.announceAt).slice(0, 5);
  if (c.note) out.note = String(c.note).slice(0, 200);
  if (c.source) out.source = String(c.source).slice(0, 32);
  return out;
}
async function loadManual() {
  try {
    const client = await getRedisClient(); if (!client) return emptyManual();
    const raw = await client.get(REDIS_KEY); if (!raw) return emptyManual();
    const doc = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { enabled: doc.enabled !== false, counties: doc.counties || {}, overrides: Array.isArray(doc.overrides) ? doc.overrides : [], byDate: doc.byDate || {}, meta: doc.meta || {}, updatedAt: doc.updatedAt || null };
  } catch (e) { return emptyManual(); }
}
async function saveManual(doc) {
  const client = await getRedisClient(); if (!client) return { ok: false, reason: "redis-unavailable" };
  const updatedAt = new Date().toISOString();
  await client.set(REDIS_KEY, JSON.stringify({ enabled: doc.enabled !== false, counties: doc.counties || {}, overrides: doc.overrides || [], byDate: doc.byDate || {}, meta: doc.meta || {}, updatedAt }));
  return { ok: true, updatedAt };
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
  const counties = {}; const mapPaint = {};
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
    const entry = { status, source: "dgpa", forDate: side === "tomorrow" ? taipeiYmd(1) : taipeiYmd(0), note: status === "pending" ? "尚未宣布" : day.text || null };
    if (Object.keys(districts).length) entry.districts = districts;
    counties[name] = entry;
    mapPaint[name] = paintTier(entry);
  }
  return { counties, mapPaint };
}
/** DGPA 尚未宣布時，用手動設定蓋上去 */
function applyManualOnTop(baseCounties, manual, ymd, isTomorrow) {
  const overrides = new Set(manual.overrides || []);
  const dayMap = (manual.byDate && manual.byDate[ymd]) || {};
  const todayMap = manual.counties || {};
  const out = {};
  for (const name of COUNTIES) {
    let e = { ...(baseCounties[name] || { status: "pending", source: "dgpa", forDate: ymd }) };
    const man = isTomorrow ? (dayMap[name] || null) : (dayMap[name] || todayMap[name] || null);
    if (!man || !man.status) { out[name] = e; continue; }
    const dgpaSoft = e.status === "pending" || e.status === "none";
    const force = overrides.has(name);
    if (dgpaSoft || force || (man.source && man.source !== "dgpa" && man.source !== "auto-18h")) {
      e = {
        status: man.status,
        source: "manual",
        forDate: ymd,
        note: man.note || (man.status === "pending" ? "尚未宣布（手動）" : null),
      };
      if (man.districts) e.districts = { ...man.districts };
      if (man.status === "pending" && man.announceAt) e.announceAt = man.announceAt;
    } else if (man.districts && Object.keys(man.districts).length) {
      e.districts = { ...(e.districts || {}), ...man.districts };
    }
    out[name] = e;
  }
  return out;
}
function buildMapPaint(counties) {
  const o = {}; for (const n of COUNTIES) o[n] = paintTier(counties[n]); return o;
}
function sanitizeCounties(c) {
  const o = {}; for (const [k, v] of Object.entries(c || {})) { const n = normEntry(v); if (n) o[k] = n; } return o;
}
function sanitizeByDate(bd) {
  const o = {};
  for (const [ymd, map] of Object.entries(bd || {})) {
    if (!DATE_RE.test(ymd)) continue;
    const day = {};
    for (const [k, v] of Object.entries(map || {})) {
      const n = normEntry(v); if (n) { n.forDate = n.forDate || ymd; day[k] = n; }
    }
    if (Object.keys(day).length) o[ymd] = day;
  }
  return o;
}

async function handleClosuresRequest(req, res) {
  const q = req.query || {};
  const isAdmin = q.admin === "1" || q.admin === "true";
  const action = String(q.action || "").toLowerCase();

  if (req.method === "POST" && isAdmin && action === "save") {
    const admin = await requireAdmin(req, res); if (!admin) return;
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { return res.status(400).json({ ok: false, reason: "invalid-json" }); } }
    if (!body || typeof body.enabled !== "boolean" || !body.counties) return res.status(400).json({ ok: false, reason: "invalid-body" });
    const existing = await loadManual();
    const nextCounties = sanitizeCounties(body.counties);
    const nextByDate = body.byDate != null ? sanitizeByDate(body.byDate) : (existing.byDate || {});
    const nextOverrides = Array.isArray(body.overrides) ? body.overrides : (existing.overrides || []);
    const result = await saveManual({ enabled: body.enabled, counties: nextCounties, overrides: nextOverrides, byDate: nextByDate, meta: existing.meta || {} });
    if (!result.ok) return res.status(503).json(result);
    return res.status(200).json({
      ok: true, updatedAt: result.updatedAt, enabled: body.enabled,
      counties: nextCounties, overrides: nextOverrides, byDate: nextByDate,
      manual: { enabled: body.enabled, counties: nextCounties, overrides: nextOverrides, byDate: nextByDate, updatedAt: result.updatedAt },
    });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ ok: false, reason: "method-not-allowed" });
  }
  if (isAdmin) { const admin = await requireAdmin(req, res); if (!admin) return; }

  const [manual, suspension] = await Promise.all([
    loadManual(),
    handleSuspensionQuery({ type: "suspension", day: "all" }),
  ]);

  const hour = taipeiHour();
  const todayY = taipeiYmd(0);
  const tomY = taipeiYmd(1);
  const todaySide = buildSide(suspension, "today");
  const tomSide = buildSide(suspension, "tomorrow");

  const counties = applyManualOnTop(todaySide.counties, manual, todayY, false);
  const tomorrowCounties = hour >= 18 ? applyManualOnTop(tomSide.counties, manual, tomY, true) : {};
  const mapPaint = buildMapPaint(counties);
  const tomorrowMapPaint = hour >= 18 ? buildMapPaint(tomorrowCounties) : {};
  const updatedAt = manual.updatedAt || new Date().toISOString();
  const enabled = manual.enabled !== false;

  const payload = {
    ok: true, enabled, forDate: todayY, taipeiToday: todayY, taipeiTomorrow: tomY, updatedAt,
    counties, mapPaint,
    tomorrowCounties, tomorrowMapPaint,
    dgpa: {
      ok: Boolean(suspension && suspension.ok),
      updatedAt: suspension && suspension.updatedAt,
      hasAnySuspension: Boolean(suspension && suspension.hasAnySuspension),
      counties: todaySide.counties,
    },
    scheduleLifecycle: { hour, afterSix: hour >= 18, rule: "DGPA尚未宣布時可用手動；手動存 Redis byDate" },
  };

  if (isAdmin) {
    payload.counties = manual.counties || {};
    payload.overrides = manual.overrides || [];
    payload.byDate = manual.byDate || {};
    payload.manual = { enabled, counties: manual.counties || {}, overrides: manual.overrides || [], byDate: manual.byDate || {}, updatedAt: manual.updatedAt || null };
    payload.effective = { enabled, forDate: todayY, counties, mapPaint, updatedAt };
    payload.notice = "DGPA尚未宣布的縣市可手動設定；存檔寫入 Redis。";
  }

  res.setHeader("Cache-Control", "private, max-age=15");
  return res.status(200).json(payload);
}

module.exports = {
  handleClosuresRequest, loadManual, saveManual, paintTier,
  buildMapPaint: (c) => { const o = {}; for (const k of Object.keys(c || {})) o[k] = paintTier(c[k]); return o; },
  mergeClosures: () => ({ counties: {}, conflicts: [] }),
  mapDgpaStatus,
};
