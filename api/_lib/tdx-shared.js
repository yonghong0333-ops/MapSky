/**
 * 共用 TDX 限流／快取（TRA / THSR / Metro）
 * - 記憶體 + /tmp + Redis（有 REDIS_URL 時跨冷啟動共用）
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const TOKEN_URL =
  "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";

let globalCooldownUntil = 0;
let memoryToken = null;
const memCache = new Map(); // key -> { data, fetchedAt }

function isCooling() {
  return Date.now() < globalCooldownUntil;
}

function tripCooldown(seconds) {
  // 不要鎖太久：15–40 秒足夠避開連續打爆
  const s = Math.min(40, Math.max(12, Number(seconds) || 20));
  globalCooldownUntil = Date.now() + s * 1000;
}

function tmpPath(prefix, name) {
  const safe = String(name).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return path.join(os.tmpdir(), `nexora-${prefix}-${safe}.json`);
}

function memKey(prefix, name) {
  return `${prefix}:${name}`;
}

function readLocal(prefix, name, ttlMs, allowStaleMs) {
  const k = memKey(prefix, name);
  const hit = memCache.get(k);
  if (hit && hit.fetchedAt) {
    const age = Date.now() - hit.fetchedAt;
    if (age < ttlMs) return { data: hit.data, stale: false, age };
    if (allowStaleMs && age < allowStaleMs) return { data: hit.data, stale: true, age };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(tmpPath(prefix, name), "utf-8"));
    if (raw && raw.fetchedAt) {
      const age = Date.now() - raw.fetchedAt;
      if (age < ttlMs || (allowStaleMs && age < allowStaleMs)) {
        memCache.set(k, raw);
        return { data: raw.data, stale: age >= ttlMs, age };
      }
    }
  } catch {
    /* */
  }
  return null;
}

function writeLocal(prefix, name, data) {
  const payload = { data, fetchedAt: Date.now() };
  memCache.set(memKey(prefix, name), payload);
  try {
    fs.writeFileSync(tmpPath(prefix, name), JSON.stringify(payload), "utf-8");
  } catch {
    /* */
  }
}

async function redisGetRaw(key) {
  try {
    const { getRedisClient } = require("./redis-client");
    const client = await getRedisClient();
    if (!client) return null;
    const v = await client.get(key);
    if (!v) return null;
    return JSON.parse(v);
  } catch {
    return null;
  }
}

async function redisSetRaw(key, payload, ttlSec) {
  try {
    const { getRedisClient } = require("./redis-client");
    const client = await getRedisClient();
    if (!client) return;
    const sec = Math.max(60, Number(ttlSec) || 3600);
    await client.set(key, JSON.stringify(payload), { EX: sec });
  } catch {
    /* */
  }
}

/**
 * 同步讀（記憶體 + tmp）。async 版本才會打 Redis。
 */
function readCache(prefix, name, ttlMs, { allowStaleMs } = {}) {
  return readLocal(prefix, name, ttlMs, allowStaleMs);
}

function writeCache(prefix, name, data) {
  writeLocal(prefix, name, data);
  // fire-and-forget Redis（當日班表可放 6 小時）
  const payload = { data, fetchedAt: Date.now() };
  redisSetRaw(`tdx:${prefix}:${name}`, payload, 6 * 3600).catch(() => {});
}

async function readCacheAsync(prefix, name, ttlMs, { allowStaleMs } = {}) {
  const local = readLocal(prefix, name, ttlMs, allowStaleMs);
  if (local) return local;
  const raw = await redisGetRaw(`tdx:${prefix}:${name}`);
  if (!raw || !raw.fetchedAt) return null;
  const age = Date.now() - raw.fetchedAt;
  if (age < ttlMs || (allowStaleMs && age < allowStaleMs)) {
    writeLocal(prefix, name, raw.data);
    return { data: raw.data, stale: age >= ttlMs, age };
  }
  return null;
}

async function writeCacheAsync(prefix, name, data, ttlSec = 6 * 3600) {
  writeLocal(prefix, name, data);
  await redisSetRaw(`tdx:${prefix}:${name}`, { data, fetchedAt: Date.now() }, ttlSec);
}

function getCredentials() {
  const clientId = process.env.TDX_CLIENT_ID || "";
  const clientSecret = process.env.TDX_CLIENT_SECRET || "";
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

async function getAccessToken() {
  const { clientId, clientSecret, configured } = getCredentials();
  if (!configured) {
    return { ok: false, reason: "tdx-not-configured", hint: "請在 Vercel 設定 TDX_CLIENT_ID、TDX_CLIENT_SECRET" };
  }
  if (memoryToken && memoryToken.expiresAt > Date.now() + 60 * 1000) {
    return { ok: true, token: memoryToken.access_token };
  }
  // token 也可從 redis 拿
  const cachedTok = await redisGetRaw("tdx:access_token");
  if (cachedTok && cachedTok.access_token && cachedTok.expiresAt > Date.now() + 60 * 1000) {
    memoryToken = cachedTok;
    return { ok: true, token: memoryToken.access_token };
  }
  if (isCooling()) {
    return { ok: false, reason: "tdx-rate-limit", status: 429, hint: "TDX 冷卻中，請稍後再試" };
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (resp.status === 429) {
    tripCooldown(25);
    return { ok: false, reason: "tdx-rate-limit", status: 429, hint: "TDX API 次數用盡，約 30 秒後重試" };
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return { ok: false, reason: "tdx-token-failed", detail: String(t).slice(0, 200) };
  }
  const json = await resp.json();
  const expiresIn = Number(json.expires_in) || 3600;
  memoryToken = {
    access_token: json.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  redisSetRaw("tdx:access_token", memoryToken, Math.max(60, expiresIn - 30)).catch(() => {});
  return { ok: true, token: memoryToken.access_token };
}

async function tdxGet(apiBase, apiPath, query) {
  if (isCooling()) {
    return { ok: false, reason: "tdx-rate-limit", status: 429, hint: "TDX 冷卻中，請稍後再試" };
  }
  const tok = await getAccessToken();
  if (!tok.ok) return tok;
  const q = query ? (apiPath.includes("?") ? "&" : "?") + query : "";
  const url = `${apiBase}${apiPath}${q}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${tok.token}`,
      Accept: "application/json",
    },
  });
  if (resp.status === 429) {
    tripCooldown(25);
    return {
      ok: false,
      reason: "tdx-rate-limit",
      status: 429,
      hint: "TDX API 次數用盡，約 30 秒後重試",
      detail: "rate limit exceeded",
    };
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    return { ok: false, reason: "tdx-http", status: resp.status, detail: String(t).slice(0, 300) };
  }
  return { ok: true, data: await resp.json() };
}

module.exports = {
  getCredentials,
  getAccessToken,
  tdxGet,
  readCache,
  writeCache,
  readCacheAsync,
  writeCacheAsync,
  isCooling,
  tripCooldown,
};
