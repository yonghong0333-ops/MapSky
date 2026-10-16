/**
 * MapSky 商店：背景卡（靜態／動態）
 * - 每日貨架 4 格
 * - 購買後發 licenseKey 綁帳號
 * - 解鎖後才給 assetUrl
 */
const crypto = require("crypto");
const { getRedisClient } = require("./redis-client");

const PRODUCT_PREFIX = "store:product:";
const PRODUCT_INDEX = "store:products";
const SHELF_PREFIX = "store:shelf:";
const ENT_PREFIX = "store:ent:"; // store:ent:{userKey} -> hash productId -> JSON
const TX_PREFIX = "store:tx:"; // 防重放 transactionId

function taipeiDate(d = new Date()) {
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function userKey(payload) {
  if (!payload || !payload.provider || !payload.profile || !payload.profile.id) return null;
  return String(payload.provider) + ":" + String(payload.profile.id);
}

function makeLicenseKey(userKeyStr, productId) {
  const secret = process.env.SESSION_SECRET || "mapsky-store";
  const rand = crypto.randomBytes(12).toString("base64url");
  const sig = crypto
    .createHmac("sha256", secret)
    .update(userKeyStr + "|" + productId + "|" + rand)
    .digest("base64url")
    .slice(0, 16);
  return "msk_" + rand + "_" + sig;
}

async function redis() {
  return getRedisClient();
}

const DEFAULT_PRODUCTS = [
  {
    id: "bg_soft_blue",
    name: "柔藍靜態",
    type: "static",
    previewUrl: "/backgrounds/app-bg.jpg",
    assetUrl: "/backgrounds/app-bg.jpg",
    priceTier: "free",
    iosProductId: null,
    active: true,
  },
  {
    id: "bg_night_city",
    name: "夜城",
    type: "static",
    previewUrl: "/backgrounds/app-bg.jpg",
    assetUrl: "/backgrounds/app-bg.jpg",
    priceTier: "tier1",
    iosProductId: "mapsky.bg.nightcity",
    active: true,
  },
  {
    id: "bg_rain_loop",
    name: "雨絲動態",
    type: "animated",
    previewUrl: "/backgrounds/app-bg.jpg",
    assetUrl: "",
    priceTier: "tier2",
    iosProductId: "mapsky.bg.rainloop",
    active: true,
  },
  {
    id: "bg_aurora",
    name: "極光動態",
    type: "animated",
    previewUrl: "/backgrounds/app-bg.jpg",
    assetUrl: "",
    priceTier: "tier2",
    iosProductId: "mapsky.bg.aurora",
    active: true,
  },
  {
    id: "bg_sunny",
    name: "晴空",
    type: "static",
    previewUrl: "/backgrounds/app-bg.jpg",
    assetUrl: "/backgrounds/app-bg.jpg",
    priceTier: "tier1",
    iosProductId: "mapsky.bg.sunny",
    active: true,
  },
  {
    id: "bg_storm",
    name: "風暴動態",
    type: "animated",
    previewUrl: "/backgrounds/app-bg.jpg",
    assetUrl: "",
    priceTier: "tier3",
    iosProductId: "mapsky.bg.storm",
    active: true,
  },
];

async function ensureSeed(client) {
  const n = await client.sCard(PRODUCT_INDEX);
  if (n && n > 0) return;
  for (const p of DEFAULT_PRODUCTS) {
    const row = { ...p, createdAt: new Date().toISOString() };
    await client.set(PRODUCT_PREFIX + p.id, JSON.stringify(row));
    await client.sAdd(PRODUCT_INDEX, p.id);
  }
  const today = taipeiDate();
  const shelfKey = SHELF_PREFIX + today;
  const existing = await client.get(shelfKey);
  if (!existing) {
    const ids = DEFAULT_PRODUCTS.slice(0, 4).map((p) => p.id);
    await client.set(
      shelfKey,
      JSON.stringify({ date: today, slots: ids.map((id, i) => ({ slot: i + 1, productId: id })), updatedAt: new Date().toISOString() })
    );
  }
}

async function getProduct(productId) {
  const client = await redis();
  await ensureSeed(client);
  const raw = await client.get(PRODUCT_PREFIX + productId);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function listProducts({ activeOnly = false } = {}) {
  const client = await redis();
  await ensureSeed(client);
  const ids = await client.sMembers(PRODUCT_INDEX);
  const out = [];
  for (const id of ids || []) {
    const p = await getProduct(id);
    if (!p) continue;
    if (activeOnly && p.active === false) continue;
    out.push(publicProduct(p, false));
  }
  out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return out;
}

function publicProduct(p, includeAsset) {
  if (!p) return null;
  const base = {
    id: p.id,
    name: p.name,
    type: p.type || "static",
    previewUrl: p.previewUrl || null,
    priceTier: p.priceTier || null,
    iosProductId: p.iosProductId || null,
    active: p.active !== false,
  };
  if (includeAsset) base.assetUrl = p.assetUrl || null;
  return base;
}

async function upsertProduct(body) {
  const id = String((body && body.id) || "").trim();
  if (!id || !/^[a-zA-Z0-9_-]{2,64}$/.test(id)) {
    throw new Error("invalid-product-id");
  }
  const client = await redis();
  await ensureSeed(client);
  const prev = (await getProduct(id)) || {};
  const row = {
    ...prev,
    id,
    name: body.name != null ? String(body.name).slice(0, 80) : prev.name || id,
    type: body.type === "animated" ? "animated" : body.type === "static" ? "static" : prev.type || "static",
    previewUrl: body.previewUrl != null ? String(body.previewUrl).slice(0, 500) : prev.previewUrl || null,
    assetUrl: body.assetUrl != null ? String(body.assetUrl).slice(0, 500) : prev.assetUrl || null,
    priceTier: body.priceTier != null ? String(body.priceTier).slice(0, 32) : prev.priceTier || null,
    iosProductId: body.iosProductId != null ? String(body.iosProductId).slice(0, 128) : prev.iosProductId || null,
    active: body.active !== undefined ? Boolean(body.active) : prev.active !== false,
    updatedAt: new Date().toISOString(),
    createdAt: prev.createdAt || new Date().toISOString(),
  };
  await client.set(PRODUCT_PREFIX + id, JSON.stringify(row));
  await client.sAdd(PRODUCT_INDEX, id);
  return publicProduct(row, true);
}

async function getShelf(date) {
  const client = await redis();
  await ensureSeed(client);
  const d = date || taipeiDate();
  const raw = await client.get(SHELF_PREFIX + d);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {}
  }
  // 無排程：用預設前 4 個 active
  const products = await listProducts({ activeOnly: true });
  const ids = products.slice(0, 4).map((p) => p.id);
  while (ids.length < 4) ids.push(ids[ids.length - 1] || "bg_soft_blue");
  return {
    date: d,
    slots: ids.map((id, i) => ({ slot: i + 1, productId: id })),
    auto: true,
  };
}

async function setShelf(date, productIds) {
  const d = date || taipeiDate();
  if (!Array.isArray(productIds) || productIds.length !== 4) {
    throw new Error("need-exactly-4-slots");
  }
  const client = await redis();
  await ensureSeed(client);
  const slots = [];
  for (let i = 0; i < 4; i++) {
    const pid = String(productIds[i] || "").trim();
    const p = await getProduct(pid);
    if (!p) throw new Error("unknown-product:" + pid);
    slots.push({ slot: i + 1, productId: pid });
  }
  const row = { date: d, slots, updatedAt: new Date().toISOString() };
  await client.set(SHELF_PREFIX + d, JSON.stringify(row));
  return row;
}

async function getEntitlements(userKeyStr) {
  const client = await redis();
  const all = await client.hGetAll(ENT_PREFIX + userKeyStr);
  const list = [];
  for (const k of Object.keys(all || {})) {
    try {
      list.push(JSON.parse(all[k]));
    } catch {}
  }
  return list;
}

async function getEntitlement(userKeyStr, productId) {
  const client = await redis();
  const raw = await client.hGet(ENT_PREFIX + userKeyStr, productId);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function grantEntitlement(userKeyStr, productId, { source = "admin", transactionId = null } = {}) {
  const p = await getProduct(productId);
  if (!p) throw new Error("unknown-product");
  const existing = await getEntitlement(userKeyStr, productId);
  if (existing && existing.licenseKey) return existing;

  if (transactionId) {
    const client = await redis();
    const txKey = TX_PREFIX + String(transactionId).slice(0, 128);
    const prev = await client.get(txKey);
    if (prev) {
      try {
        return JSON.parse(prev);
      } catch {}
    }
  }

  const licenseKey = makeLicenseKey(userKeyStr, productId);
  const row = {
    productId,
    licenseKey,
    source,
    transactionId: transactionId || null,
    purchasedAt: new Date().toISOString(),
    expiresAt: null,
  };
  const client = await redis();
  await client.hSet(ENT_PREFIX + userKeyStr, productId, JSON.stringify(row));
  if (transactionId) {
    await client.set(TX_PREFIX + String(transactionId).slice(0, 128), JSON.stringify(row), { EX: 60 * 60 * 24 * 365 });
  }
  return row;
}

async function todayShelfForUser(payload) {
  const uk = userKey(payload);
  const shelf = await getShelf(taipeiDate());
  const owned = uk ? await getEntitlements(uk) : [];
  const ownedSet = new Set(owned.map((e) => e.productId));
  const slots = [];
  for (const s of shelf.slots || []) {
    const p = await getProduct(s.productId);
    slots.push({
      slot: s.slot,
      product: publicProduct(p, false),
      owned: ownedSet.has(s.productId),
    });
  }
  return {
    ok: true,
    date: shelf.date,
    slots,
    auto: Boolean(shelf.auto),
  };
}

async function ownedForUser(payload) {
  const uk = userKey(payload);
  if (!uk) return { ok: false, reason: "not-authenticated" };
  const ents = await getEntitlements(uk);
  const items = [];
  for (const e of ents) {
    const p = await getProduct(e.productId);
    items.push({
      ...e,
      product: publicProduct(p, false),
    });
  }
  return { ok: true, items };
}

async function purchaseForUser(payload, body) {
  const uk = userKey(payload);
  if (!uk) return { ok: false, reason: "not-authenticated" };
  const productId = String((body && body.productId) || "").trim();
  if (!productId) return { ok: false, reason: "missing-productId" };
  const p = await getProduct(productId);
  if (!p || p.active === false) return { ok: false, reason: "product-unavailable" };

  // 免費檔直接發
  if (p.priceTier === "free") {
    const ent = await grantEntitlement(uk, productId, { source: "free" });
    return { ok: true, entitlement: ent };
  }

  const transactionId = body.transactionId ? String(body.transactionId).slice(0, 128) : null;
  // 正式環境應驗證 App Store JWS；最小版：有 transactionId 即發放（防重放）
  // 後台測試：body.testGrant === true 且呼叫端需為 admin（由 session 層檢查）
  if (!transactionId && !body.testGrant) {
    return { ok: false, reason: "need-transaction-or-testGrant" };
  }
  const source = body.testGrant ? "test" : "iap";
  const ent = await grantEntitlement(uk, productId, { source, transactionId });
  return { ok: true, entitlement: ent };
}

async function unlockForUser(payload, body) {
  const uk = userKey(payload);
  if (!uk) return { ok: false, reason: "not-authenticated" };
  const productId = String((body && body.productId) || "").trim();
  const licenseKey = String((body && body.licenseKey) || "").trim();
  if (!productId || !licenseKey) return { ok: false, reason: "missing-product-or-key" };
  const ent = await getEntitlement(uk, productId);
  if (!ent || ent.licenseKey !== licenseKey) {
    return { ok: false, reason: "invalid-license" };
  }
  if (ent.expiresAt && new Date(ent.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  const p = await getProduct(productId);
  if (!p) return { ok: false, reason: "unknown-product" };
  return {
    ok: true,
    productId,
    type: p.type || "static",
    assetUrl: p.assetUrl || null,
    previewUrl: p.previewUrl || null,
    name: p.name,
  };
}

module.exports = {
  taipeiDate,
  userKey,
  listProducts,
  upsertProduct,
  getShelf,
  setShelf,
  todayShelfForUser,
  ownedForUser,
  purchaseForUser,
  unlockForUser,
  grantEntitlement,
  getProduct,
};
