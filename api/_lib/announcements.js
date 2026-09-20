// 共用 helper：公告推播的「歷史紀錄」，給桌面版（Electron 外殼）用。
// 桌面版沒有 Google 的推播服務可以用（Chromium 的網頁推播需要 Google 的金鑰，Electron
// 訂閱一定失敗），所以管理員發公告時，除了照舊送網頁推播（手機／瀏覽器用），也把這則公告
// 存進 Redis 的一個 List（key: push:announcements，最新的在最前面，只留最近 50 則）。
// 桌面版 App 開著的時候定時來問「有沒有比上次更新的公告」，有就用系統通知顯示。
const { getRedisClient } = require("./redis-client");

const KEY = "push:announcements";
const MAX_KEPT = 50;

async function addAnnouncement({ title, body, url }) {
  const client = await getRedisClient();
  if (!client) return null;
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    title: String(title || "").slice(0, 200),
    body: String(body || "").slice(0, 1000),
    url: String(url || "/").slice(0, 500),
  };
  await client.lPush(KEY, JSON.stringify(item));
  await client.lTrim(KEY, 0, MAX_KEPT - 1);
  return item;
}

// 回傳 ts 比 since 新的公告（舊 → 新排序），最多 limit 則。
async function getAnnouncementsSince(since, limit = 10) {
  const client = await getRedisClient();
  if (!client) return [];
  const raw = await client.lRange(KEY, 0, MAX_KEPT - 1);
  const list = raw
    .map((v) => {
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    })
    .filter((a) => a && typeof a.ts === "number" && a.ts > since)
    .sort((a, b) => a.ts - b.ts);
  return list.slice(-limit);
}

module.exports = { addAnnouncement, getAnnouncementsSince };
