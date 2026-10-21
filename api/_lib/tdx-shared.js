/**
 * 共用 TDX 限流／快取輔助（TRA / THSR / Metro 可引用）
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const TOKEN_URL =
  "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";

let globalCooldownUntil = 0;
let memoryToken = null;

function isCooling() {
  return Date.now() < globalCooldownUntil;
}

function tripCooldown(seconds) {
  const s = Math.max(15, Number(seconds) || 45);
  globalCooldownUntil = Date.now() + s * 1000;
}

function tmpPath(prefix, name) {
  return path.join(os.tmpdir(), `nexora-${prefix}-${name}.json`);
}

function readCache(prefix, name, ttlMs, { allowStaleMs } = {}) {
  try {
    const raw = JSON.parse(fs.readFileSync(tmpPath(prefix, name), "utf-8"));
    if (!raw || !raw.fetchedAt) return null;
    const age = Date.now() - raw.fetchedAt;
    if (age < ttlMs) return { data: raw.data, stale: false, age };
    if (allowStaleMs && age < allowStaleMs) return { data: raw.data, stale: true, age };
  } catch {
    /* no cache */
  }
  return null;
}

function writeCache(prefix, name, data) {
  try {
    fs.writeFileSync(tmpPath(prefix, name), JSON.stringify({ data, fetchedAt: Date.now() }), "utf-8");
  } catch {
    /* ignore */
  }
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
    tripCooldown(60);
    return { ok: false, reason: "tdx-rate-limit", status: 429, hint: "TDX API 次數用盡，約 1 分鐘後重試" };
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
    tripCooldown(60);
    return {
      ok: false,
      reason: "tdx-rate-limit",
      status: 429,
      hint: "TDX API 次數用盡，約 1 分鐘後重試",
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
  isCooling,
  tripCooldown,
};
