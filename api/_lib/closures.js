/**
 * 停班停課 — App 契約 /api/weather/closures
 * 手動設定（Redis）+ 人事行政總處（school-closure）合併。
 *
 * GET  /api/weather/closures
 * GET  /api/weather/closures?admin=1
 * POST /api/weather/closures?admin=1&action=save
 */
const { getRedisClient } = require("./redis-client");
const { handleSuspensionQuery } = require("./school-closure");
const { requireAdmin } = require("./require-admin");
const { taipeiToday } = require("./closureRollover");

const REDIS_KEY = "settings:closures";
const ALLOWED = new Set(["closed", "normal", "none", "pending"]);

const COUNTIES = [
  "基隆市", "臺北市", "新北市", "桃園市", "新竹市", "新竹縣", "苗栗縣",
  "臺中市", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣", "臺南市",
  "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣",
];

function emptyManual() {
  return { enabled: false, counties: {}, overrides: [] };
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
      updatedAt: doc.updatedAt || null,
    };
  } catch (e) {
    return { ...emptyManual(), note: String(e.message || e).slice(0, 120) };
  }
}

async function saveManual(doc) {
  const client = await getRedisClient();
  if (!client) {
    return { ok: false, reason: "redis-unavailable" };
  }
  const updatedAt = new Date().toISOString();
  const payload = {
    enabled: Boolean(doc.enabled),
    counties: doc.counties || {},
    overrides: Array.isArray(doc.overrides) ? doc.overrides : [],
    updatedAt,
  };
  await client.set(REDIS_KEY, JSON.stringify(payload));
  return { ok: true, updatedAt };
}

function mapDgpaStatus(day) {
  if (!day) return "none";
  const w = day.work || day.status || "none";
  if (w === "suspended" || w === "closed") return "closed";
  if (w === "partial") return "closed";
  if (w === "normal") return "normal";
  if (w === "unknown" || w === "pending") return "pending";
  if (w === "out_of_alert" || w === "none") return "none";
  return "none";
}

function buildDgpaInfo(suspension) {
  if (!suspension || !suspension.ok) {
    return {
      ok: false,
      stale: Boolean(suspension && suspension.stale),
      updatedAt: suspension && suspension.updatedAt,
      hasAnySuspension: false,
      counties: {},
      reason: suspension && suspension.reason,
    };
  }
  const counties = {};
  for (const it of suspension.items || []) {
    const day = it.today || it.status || {};
    const status = mapDgpaStatus(day);
    counties[it.county] = {
      status,
      note: day.text || null,
      forDate: it.forDate || null,
    };
  }
  return {
    ok: true,
    stale: Boolean(suspension.stale),
    updatedAt: suspension.updatedAt || null,
    hasAnySuspension: Boolean(suspension.hasAnySuspension),
    counties,
  };
}

function overrideKey(county, district) {
  return district ? `${county}/${district}` : county;
}

function isSoft(status) {
  return status === "none" || status === "pending" || status == null;
}

function mergeClosures(manual, dgpa) {
  const overrides = new Set(manual.overrides || []);
  const out = {};
  const conflicts = [];
  const today = taipeiToday(new Date());

  for (const name of COUNTIES) {
    const m = (manual.counties && manual.counties[name]) || null;
    const g = (dgpa.counties && dgpa.counties[name]) || null;
    const mStatus = m && m.status ? m.status : "none";
    const gStatus = g && g.status ? g.status : null;
    const key = overrideKey(name);

    let status = "none";
    let source = "dgpa";
    let forDate = (g && g.forDate) || today;
    let announceAt = null;
    let note = (g && g.note) || null;
    const districts = {};

    if (overrides.has(key) && m && !isSoft(mStatus)) {
      status = mStatus;
      source = "manual";
      forDate = m.forDate || forDate;
      if (mStatus === "pending") announceAt = m.announceAt || null;
    } else if (gStatus && !isSoft(gStatus)) {
      status = gStatus;
      source = "dgpa";
      if (m && !isSoft(mStatus) && mStatus !== gStatus) {
        conflicts.push({ county: name, district: null, manual: mStatus, dgpa: gStatus });
      }
    } else if (m && mStatus === "pending") {
      status = "pending";
      source = "manual";
      announceAt = m.announceAt || null;
      forDate = m.forDate || forDate;
    } else if (gStatus === "pending") {
      status = "pending";
      source = "dgpa";
      note = (g && g.note) || note;
    } else if (gStatus === "none") {
      status = "none";
      source = "dgpa";
    } else if (m && mStatus === "normal") {
      status = "normal";
      source = "manual";
    } else if (m && mStatus === "closed") {
      status = "closed";
      source = "manual";
    } else {
      status = gStatus || "none";
      source = gStatus ? "dgpa" : "none";
    }

    if (m && m.districts && typeof m.districts === "object") {
      for (const [dn, ds] of Object.entries(m.districts)) {
        districts[dn] = ds;
      }
    }

    const entry = { status, source, forDate };
    if (Object.keys(districts).length) entry.districts = districts;
    if (announceAt) entry.announceAt = announceAt;
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
    if (!c || typeof c !== "object") return "invalid-status";
    if (!ALLOWED.has(c.status)) return "invalid-status";
    if (c.districts && typeof c.districts === "object") {
      for (const s of Object.values(c.districts)) {
        if (!ALLOWED.has(s)) return "invalid-status";
      }
    }
  }
  return null;
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

    const result = await saveManual({
      enabled: body.enabled,
      counties: body.counties,
      overrides: body.overrides || [],
    });
    if (!result.ok) return res.status(503).json(result);
    return res.status(200).json(result);
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ ok: false, reason: "method-not-allowed" });
  }

  if (isAdminQuery) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
  }

  const [manual, suspension] = await Promise.all([
    loadManual(),
    handleSuspensionQuery({ type: "suspension", day: "all" }),
  ]);
  const dgpa = buildDgpaInfo(suspension);
  const { counties, conflicts } = mergeClosures(manual, dgpa);

  // Redis 明確關過（有 updatedAt 且 enabled=false）才關閉；否則 DGPA 正常就顯示
  const enabled =
    manual.updatedAt && manual.enabled === false
      ? false
      : Boolean(manual.enabled) || Boolean(dgpa.ok);
  const payload = {
    ok: true,
    enabled,
    updatedAt: manual.updatedAt || (dgpa.updatedAt ? new Date().toISOString() : null),
    counties,
    dgpa,
  };

  if (isAdminQuery) {
    payload.overrides = manual.overrides || [];
    payload.manual = {
      enabled: manual.enabled,
      counties: manual.counties || {},
      overrides: manual.overrides || [],
      updatedAt: manual.updatedAt,
    };
    payload.effective = {
      enabled,
      counties,
      updatedAt: payload.updatedAt,
    };
    payload.counties = manual.counties || {};
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
};
