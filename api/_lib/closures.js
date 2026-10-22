/**
 * 停班停課 — 00:00 換日 / 18:00 種子明天 / DGPA 尚未宣布可手動
 * 全縣 closed → 紅；僅「非全停但有行政區停」才黃
 */
const { getRedisClient } = require("./redis-client");
const { handleSuspensionQuery } = require("./school-closure");
const { requireAdmin } = require("./require-admin");

const REDIS_KEY = "settings:closures";
const ALLOWED = new Set(["closed", "normal", "none", "pending"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTIES = [
  "基隆市","臺北市","新北市","桃園市","新竹市","新竹縣","苗栗縣",
  "臺中市","彰化縣","南投縣","雲林縣","嘉義市","嘉義縣","臺南市",
  "高雄市","屏東縣","宜蘭縣","花蓮縣","臺東縣","澎湖縣","金門縣","連江縣",
];

function emptyManual() {
  return { enabled: true, counties: {}, overrides: [], byDate: {}, meta: {} };
}
function taipeiParts(now = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  });
  return Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
}
function taipeiToday(now = new Date()) {
  const p = taipeiParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}
function taipeiTomorrow(now = new Date()) {
  const t = taipeiToday(now);
  const [y, m, d] = t.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + 1));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}
function taipeiHour(now = new Date()) {
  return Number(taipeiParts(now).hour);
}

function normEntry(c) {
  if (!c || typeof c !== "object" || !ALLOWED.has(c.status)) return null;
  const out = { status: c.status };
  if (c.districts && typeof c.districts === "object") {
    const d = {};
    for (const [k, v] of Object.entries(c.districts)) if (ALLOWED.has(v)) d[k] = v;
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
    const client = await getRedisClient();
    if (!client) return emptyManual();
    const raw = await client.get(REDIS_KEY);
    if (!raw) return emptyManual();
    const doc = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      enabled: doc.enabled !== false,
      counties: doc.counties || {},
      overrides: Array.isArray(doc.overrides) ? doc.overrides : [],
      byDate: doc.byDate || {},
      meta: doc.meta || {},
      updatedAt: doc.updatedAt || null,
    };
  } catch (e) {
    return emptyManual();
  }
}

async function saveManual(doc) {
  const client = await getRedisClient();
  if (!client) return { ok: false, reason: "redis-unavailable" };
  const updatedAt = new Date().toISOString();
  await client.set(
    REDIS_KEY,
    JSON.stringify({
      enabled: doc.enabled !== false,
      counties: doc.counties || {},
      overrides: doc.overrides || [],
      byDate: doc.byDate || {},
      meta: doc.meta || {},
      updatedAt,
    })
  );
  return { ok: true, updatedAt };
}

function applyScheduleLifecycle(manual, now = new Date()) {
  const today = taipeiToday(now);
  const tomorrow = taipeiTomorrow(now);
  const hour = taipeiHour(now);
  const meta = { ...(manual.meta || {}) };
  let byDate = { ...(manual.byDate || {}) };
  let counties = { ...(manual.counties || {}) };
  let dirty = false;
  const events = [];

  for (const ymd of Object.keys(byDate)) {
    if (ymd < today) {
      delete byDate[ymd];
      dirty = true;
    }
  }
  for (const [name, c] of Object.entries(counties)) {
    if (c && c.forDate && c.forDate < today) {
      delete counties[name];
      dirty = true;
    }
  }

  if (meta.lastMidnightConvertFor !== today) {
    const dayMap = byDate[today] || {};
    let changed = false;
    const nextDay = { ...dayMap };
    for (const name of COUNTIES) {
      const e = nextDay[name];
      if (!e) continue;
      if (e.status === "pending" && (e.source === "auto-18h" || !e.source)) {
        nextDay[name] = {
          status: "none",
          forDate: today,
          source: "auto-midnight",
          note: "未納入警戒區",
        };
        changed = true;
      }
    }
    if (changed) {
      byDate[today] = nextDay;
      dirty = true;
      events.push({ type: "midnight-pending-to-none", for: today });
    }
    meta.lastMidnightConvertFor = today;
    dirty = true;
  }

  if (hour >= 18 && meta.lastScheduleRolloverFor !== tomorrow) {
    const existing = byDate[tomorrow] || {};
    const seeded = {};
    for (const name of COUNTIES) {
      const prev = existing[name];
      if (prev && prev.source && prev.source !== "auto-18h" && prev.source !== "dgpa" && prev.source !== "auto-midnight") {
        seeded[name] = { ...prev, forDate: tomorrow };
        continue;
      }
      if (prev && !prev.source && prev.status && prev.status !== "pending" && prev.status !== "none") {
        seeded[name] = { ...prev, forDate: tomorrow };
        continue;
      }
      seeded[name] = {
        status: "pending",
        forDate: tomorrow,
        source: "auto-18h",
        note: "尚未宣布",
      };
    }
    byDate[tomorrow] = seeded;
    meta.lastScheduleRolloverFor = tomorrow;
    dirty = true;
    events.push({ type: "rollover-18h", for: tomorrow });
  }

  return {
    manual: { ...manual, counties, byDate, meta },
    dirty,
    events,
    today,
    tomorrow,
    hour,
  };
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
  // 全縣停班 → 一律紅；不可因還留著行政區資料就變黃
  if (st === "closed") return "closed";
  // 縣市本身不是全停，但有行政區停 → 黃
  if (Object.values(districts).some((s) => s === "closed")) return "partial";
  if (st === "normal") return "normal";
  if (st === "pending") return "pending";
  if (st === "none") return "none";
  return "pending";
}

function buildSide(suspension, side, ymd) {
  const counties = {};
  for (const name of COUNTIES) {
    const it = (suspension.items || []).find((x) => x.county === name);
    const day = side === "tomorrow" ? (it && it.tomorrow) || {} : (it && it.today) || {};
    let status = mapDgpaStatus(day);
    const districts = {};
    const rawDist =
      side === "tomorrow"
        ? (it && it.districtsTomorrow) || {}
        : (it && it.districtsToday) || {};
    for (const [dn, ds] of Object.entries(rawDist)) {
      if (ds === "closed" || ds === "suspended" || ds === "partial") districts[dn] = "closed";
      else if (ds === "normal") districts[dn] = "normal";
    }
    // 全縣停保持 closed（紅）；只有非全停才用行政區畫黃
    if (status === "closed") {
      // keep closed
    } else if (
      Object.keys(districts).length &&
      Object.values(districts).some((s) => s === "closed")
    ) {
      if (status === "pending" || status === "none") status = "normal";
    }
    const entry = {
      status,
      source: "dgpa",
      forDate: ymd,
      note: status === "pending" ? "尚未宣布" : day.text || null,
    };
    if (Object.keys(districts).length) entry.districts = districts;
    counties[name] = entry;
  }
  return counties;
}

function applyManualOnTop(baseCounties, manual, ymd) {
  const overrides = new Set(manual.overrides || []);
  const dayMap = (manual.byDate && manual.byDate[ymd]) || {};
  const todayMap = {};
  for (const [name, c] of Object.entries(manual.counties || {})) {
    if (!c) continue;
    if (!c.forDate || c.forDate === ymd) todayMap[name] = c;
  }
  const out = {};
  for (const name of COUNTIES) {
    let e = {
      ...(baseCounties[name] || {
        status: "pending",
        source: "dgpa",
        forDate: ymd,
      }),
    };
    const man = dayMap[name] || todayMap[name] || null;
    if (!man || !man.status) {
      out[name] = e;
      continue;
    }
    const dgpaSoft = e.status === "pending" || e.status === "none";
    const force = overrides.has(name);
    const manIsReal =
      man.source &&
      man.source !== "dgpa" &&
      man.source !== "auto-18h" &&
      man.source !== "auto-midnight";
    if (man.status === "none" && man.source === "auto-midnight" && !dgpaSoft) {
      out[name] = e;
      continue;
    }
    if (dgpaSoft || force || manIsReal) {
      e = {
        status: man.status,
        source: man.source || "manual",
        forDate: ymd,
        note:
          man.note ||
          (man.status === "pending"
            ? "尚未宣布"
            : man.status === "none"
              ? "未納入警戒區"
              : null),
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
  const o = {};
  for (const n of COUNTIES) o[n] = paintTier(counties[n]);
  return o;
}

function sanitizeCounties(c) {
  const o = {};
  for (const [k, v] of Object.entries(c || {})) {
    const n = normEntry(v);
    if (n) o[k] = n;
  }
  return o;
}
function sanitizeByDate(bd) {
  const o = {};
  for (const [ymd, map] of Object.entries(bd || {})) {
    if (!DATE_RE.test(ymd)) continue;
    const day = {};
    for (const [k, v] of Object.entries(map || {})) {
      const n = normEntry(v);
      if (n) {
        n.forDate = n.forDate || ymd;
        day[k] = n;
      }
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
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {
        return res.status(400).json({ ok: false, reason: "invalid-json" });
      }
    }
    if (!body || typeof body.enabled !== "boolean" || !body.counties) {
      return res.status(400).json({ ok: false, reason: "invalid-body" });
    }
    const existing = await loadManual();
    const nextCounties = sanitizeCounties(body.counties);
    const nextByDate =
      body.byDate != null ? sanitizeByDate(body.byDate) : existing.byDate || {};
    const nextOverrides = Array.isArray(body.overrides)
      ? body.overrides
      : existing.overrides || [];
    const result = await saveManual({
      enabled: body.enabled,
      counties: nextCounties,
      overrides: nextOverrides,
      byDate: nextByDate,
      meta: existing.meta || {},
    });
    if (!result.ok) return res.status(503).json(result);
    return res.status(200).json({
      ok: true,
      updatedAt: result.updatedAt,
      enabled: body.enabled,
      counties: nextCounties,
      overrides: nextOverrides,
      byDate: nextByDate,
      manual: {
        enabled: body.enabled,
      counties: nextCounties,
        overrides: nextOverrides,
        byDate: nextByDate,
        updatedAt: result.updatedAt,
      },
    });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ ok: false, reason: "method-not-allowed" });
  }
  if (isAdmin) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
  }

  const [manualRaw, suspension] = await Promise.all([
    loadManual(),
    handleSuspensionQuery({ type: "suspension", day: "all" }),
  ]);

  const life = applyScheduleLifecycle(manualRaw, new Date());
  let manual = life.manual;
  if (life.dirty) {
    const saved = await saveManual({
      enabled: manual.enabled,
      counties: manual.counties,
      overrides: manual.overrides || [],
      byDate: manual.byDate,
      meta: manual.meta,
    });
    if (saved.ok) manual = { ...manual, updatedAt: saved.updatedAt };
  }

  const todaySide = buildSide(suspension, "today", life.today);
  const tomSide = buildSide(suspension, "tomorrow", life.tomorrow);
  const counties = applyManualOnTop(todaySide, manual, life.today);
  const tomorrowCounties =
    life.hour >= 18 ? applyManualOnTop(tomSide, manual, life.tomorrow) : {};
  const mapPaint = buildMapPaint(counties);
  const tomorrowMapPaint =
    life.hour >= 18 ? buildMapPaint(tomorrowCounties) : {};
  const updatedAt = manual.updatedAt || new Date().toISOString();
  const enabled = manual.enabled !== false;

  const payload = {
    ok: true,
    enabled,
    forDate: life.today,
    taipeiToday: life.today,
    taipeiTomorrow: life.tomorrow,
    updatedAt,
    counties,
    mapPaint,
    tomorrowCounties,
    tomorrowMapPaint,
    dgpa: {
      ok: Boolean(suspension && suspension.ok),
      updatedAt: suspension && suspension.updatedAt,
      hasAnySuspension: Boolean(suspension && suspension.hasAnySuspension),
      counties: todaySide,
    },
    scheduleLifecycle: {
      hour: life.hour,
      afterSix: life.hour >= 18,
      events: life.events,
      lastScheduleRolloverFor: (manual.meta || {}).lastScheduleRolloverFor || null,
      lastMidnightConvertFor: (manual.meta || {}).lastMidnightConvertFor || null,
      rule: "全縣closed=紅；分區=黃；00:00換日；手動可蓋DGPA未宣布",
    },
  };

  if (isAdmin) {
    payload.counties = manual.counties || {};
    payload.overrides = manual.overrides || [];
    payload.byDate = manual.byDate || {};
    payload.manual = {
      enabled,
      counties: manual.counties || {},
      overrides: manual.overrides || [],
      byDate: manual.byDate || {},
      updatedAt: manual.updatedAt || null,
    };
    payload.effective = {
      enabled,
      forDate: life.today,
      counties,
      mapPaint,
      updatedAt,
    };
    payload.notice = "全縣停班為紅；DGPA尚未宣布可用手動。";
  }

  res.setHeader("Cache-Control", "private, max-age=15");
  return res.status(200).json(payload);
}

module.exports = {
  handleClosuresRequest,
  loadManual,
  saveManual,
  paintTier,
  applyScheduleLifecycle,
  buildMapPaint: (c) => {
    const o = {};
    for (const k of Object.keys(c || {})) o[k] = paintTier(c[k]);
    return o;
  },
  mergeClosures: () => ({ counties: {}, conflicts: [] }),
  mapDgpaStatus,
};
