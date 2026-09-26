// 共用 helper：iOS 原生 App 的 APNs device token 清單。存法跟
// push-store.js（網頁版 Web Push 訂閱）完全對稱——一樣用 Redis Hash，
// field 是 token 本身（天生唯一），這樣可以直接用 token 刪單一筆，
// 不用整包撈出來再篩選。
const { getRedisClient } = require("./redis-client");

const HASH_KEY = "push:apns-tokens";

async function addToken(token) {
  if (!token || typeof token !== "string") return false;
  const client = await getRedisClient();
  if (!client) return false;
  await client.hSet(HASH_KEY, token, String(Date.now()));
  return true;
}

async function removeToken(token) {
  if (!token) return false;
  const client = await getRedisClient();
  if (!client) return false;
  await client.hDel(HASH_KEY, token);
  return true;
}

async function getAllTokens() {
  const client = await getRedisClient();
  if (!client) return [];
  const raw = await client.hGetAll(HASH_KEY);
  return Object.keys(raw);
}

module.exports = { addToken, removeToken, getAllTokens };
