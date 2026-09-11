// 共用 helper：手動公告推播的訂閱清單存取。
// 存成一個 Redis Hash（key: push:subscriptions），field 是每個裝置訂閱的
// endpoint（本身就是唯一值），value 是整包訂閱物件（endpoint + keys）的 JSON。
// 用 Hash 而不是 Set/List 是因為要能用 endpoint 直接刪除單一筆，不用整包撈出來再篩選。
const { getRedisClient } = require("./redis-client");

const HASH_KEY = "push:subscriptions";

async function addSubscription(subscription) {
  if (!subscription || !subscription.endpoint) return false;
  const client = await getRedisClient();
  if (!client) return false;
  await client.hSet(HASH_KEY, subscription.endpoint, JSON.stringify(subscription));
  return true;
}

async function removeSubscription(endpoint) {
  if (!endpoint) return false;
  const client = await getRedisClient();
  if (!client) return false;
  await client.hDel(HASH_KEY, endpoint);
  return true;
}

async function getAllSubscriptions() {
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

module.exports = { addSubscription, removeSubscription, getAllSubscriptions };
