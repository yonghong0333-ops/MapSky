// 使用者自訂資料（暱稱、大頭貼）—— 跟管理員名單、會員 ID 一樣存在 Redis，
// 不用資料庫也能即時讀寫、不用重新部署。每個帳號一筆，key 是 provider:id。
const { getRedisClient } = require("./redis-client");

function profileKey(provider, id) {
  return `profile:${provider}:${id}`;
}

async function getUserProfile(provider, id) {
  if (!provider || !id) return null;
  let client;
  try {
    client = await getRedisClient();
  } catch (e) {
    return null;
  }
  if (!client) return null;
  try {
    const raw = await client.get(profileKey(provider, id));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// patch 只帶要改的欄位（例如只改暱稱，不動大頭貼），會跟現有資料合併存回去。
async function setUserProfile(provider, id, patch) {
  const client = await getRedisClient();
  if (!client) throw new Error("尚未設定 Redis，無法儲存個人資料");
  const current = (await getUserProfile(provider, id)) || {};
  const next = { ...current, ...patch };
  await client.set(profileKey(provider, id), JSON.stringify(next));
  return next;
}

module.exports = { getUserProfile, setUserProfile };
