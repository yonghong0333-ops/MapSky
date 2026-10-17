/**
 * 城市天際線剪影：抽卡解鎖、綁定帳號
 * 資料在 Redis；圖可存 base64 或 repo 內相對路徑（僅能經 API 讀取）
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getRedisClient } = require("./redis-client");

const SKY_PREFIX = "skyline:meta:";
const SKY_INDEX = "skyline:index";
const SKY_IMG = "skyline:img:"; // skyline:img:{id}:{slot}
const USER_SKY = "skyline:user:"; // hash userKey -> skylineId -> JSON
const GACHA_IDEM = "skyline:gacha:idem:";
const GACHA_TX = "skyline:gacha:tx:";
const GACHA_RATE = "skyline:gacha:rate:"; // userKey -> count window

const SLOTS = ["day", "dusk", "night", "lights", "preview"];
const SIGN_TTL_SEC = 10 * 60;

function userKeyFromPayload(payload) {
  if (!payload || !payload.provider || !payload.profile || !payload.profile.id) return null;
  return String(payload.provider) + ":" + String(payload.profile.id);
}

function secret() {
  return process.env.SESSION_SECRET || process.env.SKYLINE_SIGN_SECRET || "mapsky-skyline";
}

function publicBase() {
  return (process.env.PUBLIC_BASE_URL || "https://mapskyapp.vercel.app").replace(/\/$/, "");
}

function signParams({ userKey, id, slot, version, exp }) {
  const payload = [userKey, id, slot, String(version), String(exp)].join("|");
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

function makeSignedUrl({ userKey, id, slot, version }) {
  const exp = Math.floor(Date.now() / 1000) + SIGN_TTL_SEC;
  const sig = signParams({ userKey, id, slot, version, exp });
  const q = new URLSearchParams({
    id,
    slot,
    v: String(version),
    exp: String(exp),
    sig,
  });
  return publicBase() + "/api/weather/skyline-image?" + q.toString();
}

function verifySignedQuery(q, userKey) {
  const id = String(q.id || "");
  const slot = String(q.slot || "");
  const version = String(q.v || q.version || "1");
  const exp = Number(q.exp || 0);
  const sig = String(q.sig || "");
  if (!id || !slot || !sig || !exp) return { ok: false, reason: "bad-token" };
  if (exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: "expired" };
  const expect = signParams({ userKey, id, slot, version, exp });
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad-sig" };
  }
  return { ok: true, id, slot, version: Number(version) || 1 };
}

const DEFAULT_SKYLINES = [
  {
    id: "kaohsiung-love-river",
    name: "高雄 愛河灣",
    lat: 22.6273,
    lon: 120.3014,
    version: 1,
    aspect: 2.4,
    baseline: 0.0,
    maxHeight: 0.45,
    rarity: "common",
    weight: 100,
    active: true,
    // 圖未上傳前 paths 為 null；admin 上傳後寫入 Redis 圖位
    paths: { day: null, dusk: null, night: null, lights: null, preview: null },
  },
  {
    id: "taipei-basin",
    name: "臺北 盆地天際",
    lat: 25.033,
    lon: 121.5654,
    version: 1,
    aspect: 2.4,
    baseline: 0.0,
    maxHeight: 0.48,
    rarity: "rare",
    weight: 40,
    active: true,
    paths: { day: null, dusk: null, night: null, lights: null, preview: null },
  },
];

async function redis() {
  return getRedisClient();
}

async function ensureSeed() {
  const client = await redis();
  const n = await client.sCard(SKY_INDEX);
  if (n && n > 0) return;
  for (const s of DEFAULT_SKYLINES) {
    const row = { ...s, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await client.set(SKY_PREFIX + s.id, JSON.stringify(row));
    await client.sAdd(SKY_INDEX, s.id);
  }
}

async function getMeta(id) {
  await ensureSeed();
  const client = await redis();
  const raw = await client.get(SKY_PREFIX + id);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function listAllMeta({ activeOnly = false } = {}) {
  await ensureSeed();
  const client = await redis();
  const ids = await client.sMembers(SKY_INDEX);
  const out = [];
  for (const id of ids || []) {
    const m = await getMeta(id);
    if (!m) continue;
    if (activeOnly && m.active === false) continue;
    out.push(m);
  }
  return out;
}

async function userOwns(userKey, skylineId) {
  const client = await redis();
  const raw = await client.hGet(USER_SKY + userKey, skylineId);
  return Boolean(raw);
}

async function listOwnedIds(userKey) {
  const client = await redis();
  const all = await client.hGetAll(USER_SKY + userKey);
  return Object.keys(all || {});
}

function toAppItem(meta, userKey) {
  const v = meta.version || 1;
  const images = { day: makeSignedUrl({ userKey, id: meta.id, slot: "day", version: v }) };
  if (meta.paths && (meta.paths.dusk || meta.hasDusk)) {
    images.dusk = makeSignedUrl({ userKey, id: meta.id, slot: "dusk", version: v });
  }
  if (meta.paths && (meta.paths.night || meta.hasNight)) {
    images.night = makeSignedUrl({ userKey, id: meta.id, slot: "night", version: v });
  }
  const item = {
    id: meta.id,
    name: meta.name,
    version: v,
    images,
    aspect: meta.aspect != null ? Number(meta.aspect) : 2.4,
    baseline: meta.baseline != null ? Number(meta.baseline) : 0.0,
    maxHeight: meta.maxHeight != null ? Number(meta.maxHeight) : 0.45,
  };
  if (meta.paths && (meta.paths.preview || meta.hasPreview)) {
    item.preview = makeSignedUrl({ userKey, id: meta.id, slot: "preview", version: v });
  }
  if (meta.paths && (meta.paths.lights || meta.hasLights)) {
    item.lights = makeSignedUrl({ userKey, id: meta.id, slot: "lights", version: v });
  }
  // 若尚未上傳任何圖，仍給 day 簽名 URL（取圖時 404）
  return item;
}

async function listOwnedForApp(payload) {
  const userKey = userKeyFromPayload(payload);
  if (!userKey) return { error: "not-authenticated" };
  await ensureSeed();
  const ids = await listOwnedIds(userKey);
  const items = [];
  for (const id of ids) {
    const meta = await getMeta(id);
    if (!meta || meta.active === false) continue;
    items.push(toAppItem(meta, userKey));
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  return { items };
}

async function grantSkyline(userKey, skylineId, source) {
  const meta = await getMeta(skylineId);
  if (!meta) throw new Error("unknown-skyline");
  const client = await redis();
  const existing = await client.hGet(USER_SKY + userKey, skylineId);
  if (existing) {
    try {
      return { duplicate: true, record: JSON.parse(existing) };
    } catch {
      return { duplicate: true, record: null };
    }
  }
  const record = {
    skylineId,
    obtainedAt: new Date().toISOString(),
    source: source || "admin",
  };
  await client.hSet(USER_SKY + userKey, skylineId, JSON.stringify(record));
  return { duplicate: false, record };
}

async function revokeSkyline(userKey, skylineId) {
  const client = await redis();
  await client.hDel(USER_SKY + userKey, skylineId);
  return { ok: true };
}

async function rateLimitDraw(userKey) {
  const client = await redis();
  const key = GACHA_RATE + userKey;
  const n = await client.incr(key);
  if (n === 1) await client.expire(key, 60);
  // 每分鐘最多 20 次（免費期寬鬆）
  if (n > 20) return false;
  return true;
}

async function gachaDraw(payload, { poolId, idempotencyKey, transactionId } = {}) {
  const userKey = userKeyFromPayload(payload);
  if (!userKey) return { ok: false, reason: "not-authenticated" };

  const client = await redis();
  await ensureSeed();

  if (idempotencyKey) {
    const idemKey = GACHA_IDEM + userKey + ":" + String(idempotencyKey).slice(0, 128);
    const prev = await client.get(idemKey);
    if (prev) {
      try {
        return JSON.parse(prev);
      } catch {}
    }
  }

  if (transactionId) {
    const txKey = GACHA_TX + String(transactionId).slice(0, 128);
    const prevTx = await client.get(txKey);
    if (prevTx) {
      try {
        return JSON.parse(prevTx);
      } catch {}
    }
  }

  if (!(await rateLimitDraw(userKey))) {
    return { ok: false, reason: "rate-limited" };
  }

  // 免費期：不扣款。日後 IAP 在此驗證 JWS 後再往下。
  const pool = (await listAllMeta({ activeOnly: true })).filter((m) => (m.weight || 0) > 0);
  if (!pool.length) return { ok: false, reason: "empty-pool" };

  const total = pool.reduce((s, m) => s + (Number(m.weight) || 0), 0);
  let r = Math.random() * total;
  let won = pool[pool.length - 1];
  for (const m of pool) {
    r -= Number(m.weight) || 0;
    if (r <= 0) {
      won = m;
      break;
    }
  }

  const grant = await grantSkyline(userKey, won.id, "gacha");
  const result = {
    ok: true,
    poolId: poolId || "default",
    won: {
      id: won.id,
      name: won.name,
      rarity: won.rarity || "common",
      duplicate: Boolean(grant.duplicate),
    },
  };

  if (idempotencyKey) {
    const idemKey = GACHA_IDEM + userKey + ":" + String(idempotencyKey).slice(0, 128);
    await client.set(idemKey, JSON.stringify(result), { EX: 60 * 60 * 24 * 7 });
  }
  if (transactionId) {
    await client.set(GACHA_TX + String(transactionId).slice(0, 128), JSON.stringify(result), {
      EX: 60 * 60 * 24 * 365,
    });
  }
  return result;
}

async function gachaOdds() {
  await ensureSeed();
  const pool = await listAllMeta({ activeOnly: true });
  const total = pool.reduce((s, m) => s + (Number(m.weight) || 0), 0) || 1;
  const byRarity = {};
  const items = pool.map((m) => {
    const w = Number(m.weight) || 0;
    const p = w / total;
    const rarity = m.rarity || "common";
    byRarity[rarity] = (byRarity[rarity] || 0) + p;
    return {
      id: m.id,
      name: m.name,
      rarity,
      weight: w,
      probability: Math.round(p * 10000) / 10000,
      probabilityPercent: Math.round(p * 10000) / 100,
    };
  });
  return {
    ok: true,
    poolId: "default",
    free: true,
    note: "目前為免費抽卡（尚未接 App Store 內購）",
    rarities: Object.keys(byRarity).map((r) => ({
      rarity: r,
      probability: Math.round(byRarity[r] * 10000) / 10000,
      probabilityPercent: Math.round(byRarity[r] * 10000) / 100,
    })),
    items,
  };
}

async function upsertSkyline(body) {
  const id = String((body && body.id) || "").trim();
  if (!id || !/^[a-z0-9-]{2,64}$/.test(id)) throw new Error("invalid-id");
  await ensureSeed();
  const prev = (await getMeta(id)) || {};
  let version = prev.version || 1;
  const bump =
    body.bumpVersion === true ||
    body.imageBase64 ||
    body.imagesBase64 ||
    (body.paths && JSON.stringify(body.paths) !== JSON.stringify(prev.paths));
  if (bump && prev.id) version = version + 1;

  const row = {
    ...prev,
    id,
    name: body.name != null ? String(body.name).slice(0, 80) : prev.name || id,
    lat: body.lat != null ? Number(body.lat) : prev.lat,
    lon: body.lon != null ? Number(body.lon) : prev.lon,
    version,
    aspect: body.aspect != null ? Number(body.aspect) : prev.aspect != null ? prev.aspect : 2.4,
    baseline: body.baseline != null ? Number(body.baseline) : prev.baseline != null ? prev.baseline : 0,
    maxHeight: body.maxHeight != null ? Number(body.maxHeight) : prev.maxHeight != null ? prev.maxHeight : 0.45,
    rarity: body.rarity != null ? String(body.rarity).slice(0, 32) : prev.rarity || "common",
    weight: body.weight != null ? Number(body.weight) : prev.weight != null ? prev.weight : 10,
    active: body.active !== undefined ? Boolean(body.active) : prev.active !== false,
    paths: { ...(prev.paths || {}), ...(body.paths || {}) },
    updatedAt: new Date().toISOString(),
    createdAt: prev.createdAt || new Date().toISOString(),
  };

  const client = await redis();
  // 可一次上傳多 slot base64：imagesBase64: { day: "...", night: "..." }
  const imagesBase64 = body.imagesBase64 || {};
  if (body.imageBase64 && body.slot) {
    imagesBase64[body.slot] = body.imageBase64;
  }
  for (const slot of Object.keys(imagesBase64)) {
    if (SLOTS.indexOf(slot) === -1) continue;
    let b64 = String(imagesBase64[slot] || "");
    b64 = b64.replace(/^data:image\/\w+;base64,/, "");
    if (!b64 || b64.length > 2.5e6) continue; // ~2MB
    await client.set(SKY_IMG + id + ":" + slot, b64);
    row.paths = row.paths || {};
    row.paths[slot] = "redis";
    if (slot === "day") row.hasDay = true;
    if (slot === "dusk") row.hasDusk = true;
    if (slot === "night") row.hasNight = true;
    if (slot === "lights") row.hasLights = true;
    if (slot === "preview") row.hasPreview = true;
  }

  await client.set(SKY_PREFIX + id, JSON.stringify(row));
  await client.sAdd(SKY_INDEX, id);
  return row;
}

async function loadImageBuffer(id, slot) {
  if (SLOTS.indexOf(slot) === -1) return null;
  const client = await redis();
  const b64 = await client.get(SKY_IMG + id + ":" + slot);
  if (b64) {
    return { buffer: Buffer.from(b64, "base64"), contentType: "image/png" };
  }
  const meta = await getMeta(id);
  const rel = meta && meta.paths && meta.paths[slot];
  if (rel && rel !== "redis" && typeof rel === "string") {
    // 僅允許 repo 內 skyline-assets/ 相對路徑
    if (rel.startsWith("skyline-assets/") && !rel.includes("..")) {
      const full = path.join(process.cwd(), rel);
      if (fs.existsSync(full)) {
        return { buffer: fs.readFileSync(full), contentType: "image/png" };
      }
    }
  }
  return null;
}

async function serveImage({ payload, query }) {
  const userKey = userKeyFromPayload(payload);
  if (!userKey) return { status: 401, body: { ok: false, reason: "not-authenticated" } };

  let id = String(query.id || "");
  let slot = String(query.slot || "day");
  let version = Number(query.v || query.version || 1);

  if (query.sig) {
    const v = verifySignedQuery(query, userKey);
    if (!v.ok) return { status: 403, body: { ok: false, reason: v.reason } };
    id = v.id;
    slot = v.slot;
    version = v.version;
  }

  if (SLOTS.indexOf(slot) === -1) {
    return { status: 400, body: { ok: false, reason: "bad-slot" } };
  }

  const owns = await userOwns(userKey, id);
  if (!owns) return { status: 403, body: { ok: false, reason: "not-owned" } };

  const meta = await getMeta(id);
  if (!meta || meta.active === false) {
    return { status: 404, body: { ok: false, reason: "not-found" } };
  }

  const img = await loadImageBuffer(id, slot);
  if (!img) return { status: 404, body: { ok: false, reason: "no-image" } };

  return {
    status: 200,
    headers: {
      "Content-Type": img.contentType,
      "Cache-Control": "private, max-age=300",
      "X-Skyline-Id": id,
      "X-Skyline-Version": String(meta.version || version),
    },
    buffer: img.buffer,
  };
}

module.exports = {
  userKeyFromPayload,
  listOwnedForApp,
  serveImage,
  gachaDraw,
  gachaOdds,
  upsertSkyline,
  grantSkyline,
  revokeSkyline,
  listAllMeta,
  getMeta,
  listOwnedIds,
  SLOTS,
};
