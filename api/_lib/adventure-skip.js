// 「動態島冒險」略過名單 —— 跟公開測試版資格名單（beta-testers.js）同一套做法：
// 存在 Redis，後台管理可以直接指派/踢除，不用改環境變數、不用重新部署。
// 只有超級管理員能指派/踢除。
//
// 這份名單只影響一件事：設定頁「動態島」卡片要不要「集滿 3 個條件才能用」這個限制。
// 在名單裡的人（或超級管理員本人）不用集滿條件就能直接用；勾選清單本身還是照實際情況
// 顯示（不會被假造成全部打勾），只是解鎖與否不再受它限制。

const { getRedisClient } = require("./redis-client");

const REDIS_SKIP_LIST_KEY = "adventure-skip:dynamic-list";

function sessionKey(payload) {
  if (!payload || !payload.provider || !payload.profile || !payload.profile.id) return null;
  return `${payload.provider}:${payload.profile.id}`;
}

async function getAdventureSkipList() {
  try {
    const client = await getRedisClient();
    if (!client) return [];
    const raw = await client.get(REDIS_SKIP_LIST_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

async function isAdventureSkip(payload) {
  const key = sessionKey(payload);
  if (!key) return false;
  const list = await getAdventureSkipList();
  return list.some((t) => t.key === key);
}

async function addAdventureSkip({ provider, id, name }) {
  const client = await getRedisClient();
  if (!client) throw new Error("尚未設定 Redis，無法指派略過資格");
  const key = `${provider}:${id}`;
  const list = await getAdventureSkipList();
  if (list.some((t) => t.key === key)) return list; // 已經在名單裡了，不重複加
  const next = [...list, { key, provider, id, name: name || id, addedAt: new Date().toISOString() }];
  await client.set(REDIS_SKIP_LIST_KEY, JSON.stringify(next));
  return next;
}

async function removeAdventureSkip({ provider, id }) {
  const client = await getRedisClient();
  if (!client) throw new Error("尚未設定 Redis，無法踢除略過資格");
  const key = `${provider}:${id}`;
  const list = await getAdventureSkipList();
  const next = list.filter((t) => t.key !== key);
  await client.set(REDIS_SKIP_LIST_KEY, JSON.stringify(next));
  return next;
}

module.exports = { getAdventureSkipList, isAdventureSkip, addAdventureSkip, removeAdventureSkip };
