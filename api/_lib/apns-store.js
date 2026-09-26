// 共用 helper：iOS 原生 App（Capacitor @capacitor/push-notifications）裝置
// token 的存取，架構照抄 push-store.js（網頁推播的訂閱清單），只是這裡存的
// 是 APNs 的裝置 token（一個字串），不是整包 Web Push 訂閱物件。
// 存成一個 Redis Hash（key: push:ios-tokens），field 是 token 本身（本身就是
// 唯一值），value 是 { token, addedAt } 的 JSON——多存一個 addedAt 純粹方便
// 之後後台要清舊資料時可以用，不影響現有送推播的邏輯。
const { getRedisClient } = require("./redis-client");

const HASH_KEY = "push:ios-tokens";

async function addIosToken(token) {
  if (!token || typeof token !== "string") return false;
  const client = await getRedisClient();
  if (!client) return false;
  await client.hSet(HASH_KEY, token, JSON.stringify({ token, addedAt: Date.now() }));
  return true;
}

async function removeIosToken(token) {
  if (!token) return false;
  const client = await getRedisClient();
  if (!client) return false;
  await client.hDel(HASH_KEY, token);
  return true;
}

async function getAllIosTokens() {
  const client = await getRedisClient();
  if (!client) return [];
  const raw = await client.hGetAll(HASH_KEY);
  return Object.values(raw)
    .map((v) => {
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = { addIosToken, removeIosToken, getAllIosTokens };
