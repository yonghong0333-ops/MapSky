// 後台管理權限判斷 —— 分兩層：
//
// 1. 超級管理員：寫在 Vercel 環境變數 ADMIN_IDS 裡，格式是「provider:id」
//    用逗號分隔，例如：facebook:1234567890,google:987654321
//    也支援 email:you@example.com（Email 登入身分）。
//    這一層是寫死的白名單，只能去 Vercel 後台改。
//
// 2. 一般管理員：存在 Redis 裡，可在後台指派／踢除。

const { getRedisClient } = require("./redis-client");

const REDIS_ADMIN_LIST_KEY = "admin:dynamic-list";

function getSuperAdminIds() {
  return (process.env.ADMIN_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function sessionKey(payload) {
  if (!payload || !payload.provider || !payload.profile || !payload.profile.id) return null;
  return `${payload.provider}:${payload.profile.id}`;
}

function isSuperAdminSession(payload) {
  const admins = getSuperAdminIds();
  const key = sessionKey(payload);
  if (key && admins.includes(key)) return true;
  // Email 登入或身分被 email 蓋過時，也用信箱比對（ADMIN_IDS 可寫 email:xxx）
  const email = payload && payload.profile && payload.profile.email
    ? String(payload.profile.email).trim().toLowerCase()
    : "";
  if (email && admins.includes(`email:${email}`)) return true;
  // 若 session 本身就是 email provider，id 就是信箱
  if (payload && payload.provider === "email" && payload.profile && payload.profile.id) {
    const idEmail = String(payload.profile.id).trim().toLowerCase();
    if (admins.includes(`email:${idEmail}`)) return true;
  }
  return false;
}

async function getDynamicAdmins() {
  try {
    const client = await getRedisClient();
    if (!client) return [];
    const raw = await client.get(REDIS_ADMIN_LIST_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

async function isAdminSession(payload) {
  if (isSuperAdminSession(payload)) return true;
  const key = sessionKey(payload);
  if (!key) return false;
  const dynamicAdmins = await getDynamicAdmins();
  if (dynamicAdmins.some((a) => a.key === key)) return true;
  // 動態管理員也支援用 email 對上（若 id 是信箱）
  const email = payload && payload.profile && payload.profile.email
    ? String(payload.profile.email).trim().toLowerCase()
    : "";
  if (email) {
    const emailKey = `email:${email}`;
    if (dynamicAdmins.some((a) => a.key === emailKey)) return true;
  }
  return false;
}

async function addDynamicAdmin({ provider, id, name }) {
  const client = await getRedisClient();
  if (!client) throw new Error("尚未設定 Redis，無法指派一般管理員");
  const key = `${provider}:${id}`;
  if (getSuperAdminIds().includes(key)) {
    throw new Error("這個帳號已經是超級管理員了，不用另外指派");
  }
  const list = await getDynamicAdmins();
  if (list.some((a) => a.key === key)) {
    return list;
  }
  const next = [...list, { key, provider, id, name: name || id, addedAt: new Date().toISOString() }];
  await client.set(REDIS_ADMIN_LIST_KEY, JSON.stringify(next));
  return next;
}

async function removeDynamicAdmin({ provider, id }) {
  const client = await getRedisClient();
  if (!client) throw new Error("尚未設定 Redis，無法踢除一般管理員");
  const key = `${provider}:${id}`;
  if (getSuperAdminIds().includes(key)) {
    throw new Error("超級管理員不能被踢除");
  }
  const list = await getDynamicAdmins();
  const next = list.filter((a) => a.key !== key);
  await client.set(REDIS_ADMIN_LIST_KEY, JSON.stringify(next));
  return next;
}

module.exports = {
  getSuperAdminIds,
  isSuperAdminSession,
  isAdminSession,
  getDynamicAdmins,
  addDynamicAdmin,
  removeDynamicAdmin,
};
