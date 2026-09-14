// 桌面版「公開測試版」資格名單 —— 跟一般管理員名單（admin.js）同一套做法：
// 存在 Redis，後台管理可以直接指派/踢除，不用改環境變數、不用重新部署。
// 只有超級管理員能指派/踢除。
//
// 三個更新頻道對應的資格判斷：
//   正式版（stable）    —— 所有人都看得到，不需要資格
//   公開測試版（beta）  —— 這份名單裡的人，加上超級管理員
//   一般測試版（alpha） —— 只有超級管理員（見 admin.js 的 isSuperAdminSession）

const { getRedisClient } = require("./redis-client");

const REDIS_BETA_LIST_KEY = "beta-tester:dynamic-list";

function sessionKey(payload) {
  if (!payload || !payload.provider || !payload.profile || !payload.profile.id) return null;
  return `${payload.provider}:${payload.profile.id}`;
}

async function getBetaTesters() {
  try {
    const client = await getRedisClient();
    if (!client) return [];
    const raw = await client.get(REDIS_BETA_LIST_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

async function isBetaTester(payload) {
  const key = sessionKey(payload);
  if (!key) return false;
  const list = await getBetaTesters();
  return list.some((t) => t.key === key);
}

async function addBetaTester({ provider, id, name }) {
  const client = await getRedisClient();
  if (!client) throw new Error("尚未設定 Redis，無法指派公開測試版資格");
  const key = `${provider}:${id}`;
  const list = await getBetaTesters();
  if (list.some((t) => t.key === key)) return list; // 已經有資格了，不重複加
  const next = [...list, { key, provider, id, name: name || id, addedAt: new Date().toISOString() }];
  await client.set(REDIS_BETA_LIST_KEY, JSON.stringify(next));
  return next;
}

async function removeBetaTester({ provider, id }) {
  const client = await getRedisClient();
  if (!client) throw new Error("尚未設定 Redis，無法踢除公開測試版資格");
  const key = `${provider}:${id}`;
  const list = await getBetaTesters();
  const next = list.filter((t) => t.key !== key);
  await client.set(REDIS_BETA_LIST_KEY, JSON.stringify(next));
  return next;
}

module.exports = {
  getBetaTesters,
  isBetaTester,
  addBetaTester,
  removeBetaTester,
};
