// 後台管理權限判斷 —— 分兩層：
//
// 1. 超級管理員：寫在 Vercel 環境變數 ADMIN_IDS 裡，格式是「provider:id」
//    用逗號分隔，例如：facebook:1234567890,google:987654321
//    這一層是寫死的白名單，只能去 Vercel 後台改，App 本身沒有任何功能可以
//    新增/移除超級管理員，也不能把超級管理員踢掉——這是最高權限、誰都動不了。
//
// 2. 一般管理員：存在 Redis（Vercel 透過 Upstash Marketplace 整合接的）裡，
//    可以在 App 的後台管理分頁直接指派、也可以直接踢除，不用改環境變數、
//    不用重新部署。只有超級管理員能指派/踢除一般管理員。

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
  const key = sessionKey(payload);
  if (!key) return false;
  return getSuperAdminIds().includes(key);
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
  return dynamicAdmins.some((a) => a.key === key);
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
    return list; // 已經是管理員了，不重複加
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
