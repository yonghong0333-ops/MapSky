/**
 * 停班停課 — /api/weather/closures
 * 18:00：隔天整張「尚未宣布」；開始可讀隔天 API
 * 今日保留到 23:59:59；00:00 刪除過期
 */
const { getRedisClient } = require("./redis-client");
const { handleSuspensionQuery } = require("./school-closure");
const { requireAdmin } = require("./require-admin");
const { taipeiToday, taipeiTomorrow } = require("./closureRollover");

const REDIS_KEY = "settings:closures";
const ALLOWED = new Set(["closed", "normal", "none", "pending"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const COUNTIES = [
  "基隆市", "臺北市", "新北市", "桃園市", "新竹市", "新竹縣", "苗栗縣",
  "臺中市", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣", "臺南市",
  "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣",
];

function emptyManual() {
  return { enabled: false, counties: {}, overrides: [], byDate: {}, meta: {} };
}

function normalizeAnnounceAt(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function normalizeCountyEntry(c) {
  if (!c || typeof c !== "object") return null;
  if (!ALLOWED.has(c.status)) return null;
  const out = { status: c.status };
  if (c.districts && typeof c.districts === "object") {
    const d = {};
    for (const [dn, ds] of Object.entries(c.districts)) {
      if (ALLOWED.has(ds)) d[dn] = ds;
    }
    if (Object.keys(d).length) out.districts = d;
  }
  if (c.forDate && DATE_RE.test(String(c.forDate))) out.forDate = String(c.forDate);
  if (c.status === "pending") {
    const at = normalizeAnnounceAt(c.announceAt);
    if (at) out.announceAt = at;
  }
  if (c.note && typeof c.note === "string") out.note = c.note.slice(0, 200);
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
      enabled: Boolean(doc.enabled),
      counties: doc.counties && typeof doc.counties === "object" ? doc.counties : {},
      overrides: Array.isArray(doc.overrides) ? doc.overrides : [],
      byDate: doc.byDate && typeof doc.byDate === "object" ? doc.byDate : {},
      meta: doc.meta && typeof doc.meta === "object" ? doc.meta : {},
      updatedAt: doc.updatedAt || null,
    };
  } catch (e) {
    return { ...emptyManual(), note: String(e.message || e).slice(0, 120) };
  }
}

async function saveManual(doc) {
  const client = await getRedisClient();
  if (!client) return { ok: false, reason: "redis-unavailable" };
  const updatedAt = new Date().toISOString();
  const payload = {
    enabled: Boolean(doc.enabled),
    counties: doc.counties || {},
    overrides: Array.isArray(doc.overrides) ? doc.overrides : [],
    byDate: doc.byDate && typeof doc.byDate === "object" ? doc.byDate : {},
    meta: doc.meta && typeof doc.meta === "object" ? doc.meta : {},
    updatedAt,
  };
  await client.set(REDIS_KEY, JSON.stringify(payload));
  return { ok: true, updatedAt };
}

function taipeiHour(now = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return Number(Object.fromEntries(f.map((p) => [p.type, p.value])).hour);
}

function applyScheduleLifecycle(manual, suspension, now = new Date()) {
  const today = taipeiToday(now);
  const tomorrow = taipeiTomorrow(now);
  const hour = taipeiHour(now);
  const meta = { ...(manual.meta || {}) };
  let byDate = { ...(manual.byDate || {}) };
  let counties = { ...(manual.counties || {}) };
  let dirty = false;
  const events = [];

  if (meta.lastSchedulePurgeFor !== today) {
    const removed = [];
    for (const ymd of Object.keys(byDate)) {
      if (ymd < today) {
        delete byDate[ymd];
        removed.push(ymd);
      }
    }
    for (const [name, c] of Object.entries(counties)) {
      if (c && c.forDate && c.forDate < today) {
        delete counties[name];
        removed.push(`counties:${name}@${c.forDate}`);
      }
    }
    meta.lastSchedulePurgeFor = today;
    dirty = true;
    events.push({ type: "purge", removed, for: today });
  }

  const SEED_VER = 2;
  if (
    hour >= 18 &&
    (meta.lastScheduleRolloverFor !== tomorrow || meta.scheduleSeedVersion !== SEED_VER)
  ) {
    const seeded = {};
    const existing = byDate[tomorrow] || {};
    for (const name of COUNTIES) {
      const prev = existing[name];
      if (prev && prev.source && prev.source !== "auto-18h" && prev.source !== "dgpa") {
        seeded[name] = { ...prev, forDate: tomorrow };
        continue;
      }
      if (prev && !prev.source && prev.status && prev.status !== "pending") {
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
    meta.scheduleSeedVersion = SEED_VER;
    dirty = true;
    events.push({
      type: "rollover-18h",
      for: tomorrow,
      seeded: Object.keys(seeded).length,
      mode: "all-pending",
    });
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
  if (!day) return "none";
  const w = day.work || day.status || "none";
  if (w === "suspended" || w === "closed") return "closed";
  if (w === "partial") return "normal";
  if (w === "normal") return "normal";
  if (w === "unknown" || w === "pending") return "pending";
  if (w === "out_of_alert" || w === "none") return "none";
  return "none";
}

function buildDgpaInfo(suspension, side = "today") {
  if (!suspension || !suspension.ok) {
    return {
      ok: false,
      stale: Boolean(suspension && suspension.stale),
      updatedAt: suspension && suspension.updatedAt,
      hasAnySuspension: false,
      counties: {},
      reason: suspension && suspension.reason,
      side,
    };
  }
  const useTomorrow = side === "tomorrow";
  const counties = {};
  for (const it of suspension.items || []) {
    const day = useTomorrow ? it.tomorrow || {} : it.today || it.status || {};
    let status = mapDgpaStatus(day);
    const districts = {};
    const rawDist = useTomorrow
      ? it.districtsTomorrow || {}
      : it.districtsToday || it.districts || {};
    for (const [dn, ds] of Object.entries(rawDist)) {
      if (ds === "closed" || ds === "suspended" || ds === "partial") districts[dn] = "closed";
      else if (ds === "normal") districts[dn] = "normal";
    }
    if (Object.values(districts).some((s) => s === "closed") && day.work === "partial") status = "normal";
    if (Object.values(districts).some((s) => s === "closed") && status === "closed" && day.work !== "suspended") {
      status = "normal";
    }
    const entry = {
      status,
      note: day.text || null,
      forDate: useTomorrow ? null : it.forDate || null,
    };
    if (Object.keys(districts).length) entry.districts = districts;
    counties[it.county] = entry;
  }
  return {
    ok: true,
    stale: Boolean(suspension.stale),
    updatedAt: suspension.updatedAt || null,
    hasAnySuspension: Boolean(suspension.hasAnySuspension),
    counties,
    side,
  };
}

function overrideKey(county, district) {
  return district ? `${county}/${district}` : county;
}

function isSoft(status) {
  return status === "none" || status === "pending" || status == null;
}

function manualForDate(manual, ymd) {
  const base = { ...(manual.counties || {}) };
  const dayMap = (manual.byDate && manual.byDate[ymd]) || {};
  for (const [name, entry] of Object.entries(dayMap)) {
    if (!entry || typeof entry !== "object") continue;
    base[name] = { ...entry, forDate: entry.forDate || ymd };
  }
  for (const [name, entry] of Object.entries(manual.counties || {})) {
    if (entry && entry.forDate === ymd) base[name] = { ...entry };
  }
  return base;
}

function mergeClosures(manual, dgpa, viewDate) {
  const overrides = new Set(manual.overrides || []);
  const out = {};
  const conflicts = [];
  const today = viewDate || taipeiToday(new Date());
  const manualCounties = manualForDate(manual, today);

  for (const name of COUNTIES) {
    const m = manualCounties[name] || null;
    const g = (dgpa.counties && dgpa.counties[name]) || null;
    const mStatus = m && m.status ? m.status : "none";
    const gStatus = g && g.status ? g.status : null;
    const key = overrideKey(name);

    let status = "none";
    let source = "dgpa";
    let forDate = (m && m.forDate) || (g && g.forDate) || today;
    let announceAt = null;
    let note = (g && g.note) || null;
    const districts = {};

    if (overrides.has(key) && m && !isSoft(mStatus)) {
      status = mStatus;
      source = "manual";
      forDate = m.forDate || forDate;
      if (mStatus === "pending") announceAt = normalizeAnnounceAt(m.announceAt);
    } else if (m && mStatus === "pending") {
      status = "pending";
      source = m.source || "manual";
      announceAt = normalizeAnnounceAt(m.announceAt);
      forDate = m.forDate || forDate;
      note = m.note || note || "尚未宣布";
    } else if (
      m &&
      (mStatus === "closed" || mStatus === "normal") &&
      (overrides.has(key) || !gStatus || isSoft(gStatus))
    ) {
      status = mStatus;
      source = m.source || "manual";
      forDate = m.forDate || forDate;
    } else if (gStatus && !isSoft(gStatus)) {
      status = gStatus;
      source = "dgpa";
      if (m && !isSoft(mStatus) && mStatus !== gStatus) {
        conflicts.push({ county: name, district: null, manual: mStatus, dgpa: gStatus });
      }
    } else if (gStatus === "pending") {
      status = "pending";
      source = "dgpa";
      note = (g && g.note) || note || "尚未宣布";
    } else if (gStatus === "none") {
      status = "none";
      source = "dgpa";
    } else if (m && mStatus === "closed") {
      status = "closed";
      source = m.source || "manual";
    } else if (m && mStatus === "normal") {
      status = "normal";
      source = m.source || "manual";
    } else {
      status = gStatus || "none";
      source = gStatus ? "dgpa" : "none";
    }

    if (g && g.districts && typeof g.districts === "object") {
      for (const [dn, ds] of Object.entries(g.districts)) districts[dn] = ds;
    }
    if (m && m.districts && typeof m.districts === "object") {
      for (const [dn, ds] of Object.entries(m.districts)) districts[dn] = ds;
    }
    if (Object.keys(districts).length && status === "closed" && g && g.status === "normal") {
      status = "normal";
    }

    const entry = { status, source, forDate };
    if (Object.keys(districts).length) entry.districts = districts;
    if (status === "pending" && announceAt) entry.announceAt = announceAt;
    if (note) entry.note = note;
    out[name] = entry;
  }

  return { counties: out, conflicts };
}

function validateSaveBody(body) {
  if (!body || typeof body !== "object") return "invalid-body";
  if (typeof body.enabled !== "boolean") return "invalid-body";
  if (!body.counties || typeof body.counties !== "object") return "invalid-body";
  for (const [, c] of Object.entries(body.counties)) {
    if (!normalizeCountyEntry(c)) return "invalid-status";
    if (c.announceAt != null && c.announceAt !== "" && !normalizeAnnounceAt(c.announceAt)) {
      return "invalid-announceAt";
    }
    if (c.forDate != null && c.forDate !== "" && !DATE_RE.test(String(c.forDate))) {
      return "invalid-forDate";
    }
  }
  if (body.byDate != null) {
    if (typeof body.byDate !== "object") return "invalid-byDate";
    for (const [ymd, map] of Object.entries(body.byDate)) {
      if (!DATE_RE.test(ymd)) return "invalid-byDate";
      if (!map || typeof map !== "object") return "invalid-byDate";
      for (const [, c] of Object.entries(map)) {
        if (!normalizeCountyEntry(c)) return "invalid-status";
      }
    }
  }
  return null;
}

function sanitizeCounties(counties) {
  const out = {};
  for (const [name, c] of Object.entries(counties || {})) {
    const n = normalizeCountyEntry(c);
    if (n) out[name] = n;
  }
  return out;
}

function sanitizeByDate(byDate) {
  const out = {};
  for (const [ymd, map] of Object.entries(byDate || {})) {
    if (!DATE_RE.test(ymd)) continue;
    const day = {};
    for (const [name, c] of Object.entries(map || {})) {
      const n = normalizeCountyEntry(c);
      if (n) {
        n.forDate = n.forDate || ymd;
        day[name] = n;
      }
    }
    if (Object.keys(day).length) out[ymd] = day;
  }
  return out;
}

async function handleClosuresRequest(req, res) {
  const q = req.query || {};
  const isAdminQuery = q.admin === "1" || q.admin === "true";
  const action = String(q.action || "").toLowerCase();

  if (req.method === "POST" && isAdminQuery && action === "save") {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ ok: false, reason: "invalid-json" });
      }
    }
    const bad = validateSaveBody(body);
    if (bad) return res.status(400).json({ ok: false, reason: bad });

    const existing = await loadManual();
    const result = await saveManual({
      enabled: body.enabled,
      counties: sanitizeCounties(body.counties),
      overrides: body.overrides || [],
      byDate: sanitizeByDate(body.byDate || {}),
      meta: existing.meta || {},
    });
    if (!result.ok) return res.status(503).json(result);
    return res.status(200).json({
      ok: true,
      updatedAt: result.updatedAt,
      saved: {
        counties: Object.keys(sanitizeCounties(body.counties)).length,
        byDateDays: Object.keys(sanitizeByDate(body.byDate || {})).length,
      },
    });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ ok: false, reason: "method-not-allowed" });
  }

  if (isAdminQuery) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
  }

  const viewDate =
    q.forDate && DATE_RE.test(String(q.forDate))
      ? String(q.forDate)
      : String(q.day || "").toLowerCase() === "tomorrow"
        ? taipeiTomorrow(new Date())
        : taipeiToday(new Date());

  const [manualRaw, suspension] = await Promise.all([
    loadManual(),
    handleSuspensionQuery({ type: "suspension", day: "all" }),
  ]);

  const life = applyScheduleLifecycle(manualRaw, suspension, new Date());
  let manual = life.manual;
  if (life.dirty) {
    await saveManual({
      enabled: manual.enabled,
      counties: manual.counties,
      overrides: manual.overrides || [],
      byDate: manual.byDate,
      meta: manual.meta,
    });
    manual = { ...manual, updatedAt: new Date().toISOString() };
  }

  const dgpaSide =
    viewDate === life.tomorrow || String(q.day || "").toLowerCase() === "tomorrow"
      ? "tomorrow"
      : "today";
  const dgpa = buildDgpaInfo(suspension, dgpaSide);
  const { counties, conflicts } = mergeClosures(manual, dgpa, viewDate);

  const enabled =
    manual.updatedAt && manual.enabled === false
      ? false
      : Boolean(manual.enabled) || Boolean(dgpa.ok);

  const tomorrowBoard = {};
  const tMap = (manual.byDate && manual.byDate[life.tomorrow]) || {};
  for (const name of COUNTIES) {
    const e = tMap[name] || {
      status: "pending",
      forDate: life.tomorrow,
      source: "auto-18h",
      note: "尚未宣布",
    };
    tomorrowBoard[name] = {
      status: e.status || "pending",
      forDate: life.tomorrow,
      source: e.source || "auto-18h",
      note: e.note || "尚未宣布",
      ...(e.announceAt ? { announceAt: e.announceAt } : {}),
      ...(e.districts ? { districts: e.districts } : {}),
    };
  }

  const payload = {
    ok: true,
    enabled,
    forDate: viewDate,
    taipeiToday: life.today,
    taipeiTomorrow: life.tomorrow,
    updatedAt: manual.updatedAt || (dgpa.updatedAt ? new Date().toISOString() : null),
    counties,
    dgpa,
    tomorrowCounties: life.hour >= 18 ? tomorrowBoard : {},
    scheduledDates: Object.keys(manual.byDate || {}).sort(),
    scheduleLifecycle: {
      hour: life.hour,
      events: life.events,
      lastScheduleRolloverFor: (manual.meta || {}).lastScheduleRolloverFor || null,
      lastSchedulePurgeFor: (manual.meta || {}).lastSchedulePurgeFor || null,
      afterSix: life.hour >= 18,
      readingNextDayApi: dgpaSide === "tomorrow",
      rule: "18:00 建立隔天全「尚未宣布」圖；開始可讀 ?day=tomorrow；今日保留到 23:59:59；00:00 刪除過期",
    },
  };

  if (isAdminQuery) {
    payload.overrides = manual.overrides || [];
    payload.manual = {
      enabled: manual.enabled,
      counties: manual.counties || {},
      overrides: manual.overrides || [],
      byDate: manual.byDate || {},
      meta: manual.meta || {},
      updatedAt: manual.updatedAt,
    };
    payload.effective = {
      enabled,
      forDate: viewDate,
      counties,
      updatedAt: payload.updatedAt,
    };
    payload.counties = manual.counties || {};
    payload.byDate = manual.byDate || {};
    payload.conflicts = conflicts;
  }

  res.setHeader("Cache-Control", "private, max-age=30, s-maxage=30");
  return res.status(200).json(payload);
}

module.exports = {
  handleClosuresRequest,
  mergeClosures,
  buildDgpaInfo,
  mapDgpaStatus,
  loadManual,
  saveManual,
  manualForDate,
  applyScheduleLifecycle,
};
