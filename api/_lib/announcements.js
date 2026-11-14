// 共用 helper：公告／最新消息／活動
// - push:announcements：管理員推播時寫入（桌面版定時拉取 + 最新消息來源）
// - mapsky:events：活動列表（日曆頁、官網可顯示）
const { getRedisClient } = require("./redis-client");

const KEY = "push:announcements";
const EVENTS_KEY = "mapsky:events";
const MAX_KEPT = 50;

async function addAnnouncement({ title, body, url, date }) {
  const client = await getRedisClient();
  if (!client) return null;
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    title: String(title || "").slice(0, 200),
    body: String(body || "").slice(0, 1000),
    url: String(url || "/").slice(0, 500),
    date: date ? String(date).slice(0, 40) : new Date().toISOString().slice(0, 10),
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

/** 公開列表：最新在前，給 App／官網「最新消息」用 */
async function listAnnouncements(limit = 30) {
  const client = await getRedisClient();
  if (!client) return [];
  const raw = await client.lRange(KEY, 0, Math.min(MAX_KEPT, limit) - 1);
  return raw
    .map((v) => {
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    })
    .filter((a) => a && a.title)
    .map((a) => ({
      id: a.id || String(a.ts || ""),
      title: a.title,
      body: a.body || a.content || "",
      date: a.date || (a.ts ? new Date(a.ts).toISOString().slice(0, 10) : ""),
      url: a.url || a.link || "/",
      ts: a.ts || 0,
    }));
}

async function addEvent({ title, body, url, date, start, end, location }) {
  const client = await getRedisClient();
  if (!client) return null;
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    title: String(title || "").slice(0, 200),
    body: String(body || "").slice(0, 1000),
    url: String(url || "/").slice(0, 500),
    date: date ? String(date).slice(0, 40) : (start ? String(start).slice(0, 40) : new Date().toISOString().slice(0, 10)),
    start: start ? String(start).slice(0, 40) : "",
    end: end ? String(end).slice(0, 40) : "",
    location: location ? String(location).slice(0, 200) : "",
  };
  await client.lPush(EVENTS_KEY, JSON.stringify(item));
  await client.lTrim(EVENTS_KEY, 0, MAX_KEPT - 1);
  return item;
}

async function listEvents(limit = 30) {
  const client = await getRedisClient();
  if (!client) return [];
  const raw = await client.lRange(EVENTS_KEY, 0, Math.min(MAX_KEPT, limit) - 1);
  return raw
    .map((v) => {
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    })
    .filter((a) => a && a.title)
    .map((a) => ({
      id: a.id || String(a.ts || ""),
      title: a.title,
      body: a.body || "",
      date: a.date || (a.ts ? new Date(a.ts).toISOString().slice(0, 10) : ""),
      start: a.start || "",
      end: a.end || "",
      location: a.location || "",
      url: a.url || "/",
      ts: a.ts || 0,
    }));
}

/** 若 Redis 裡完全沒消息，寫入一則預設內容，避免 App 永遠空白 */
async function ensureSeedNews() {
  const client = await getRedisClient();
  if (!client) return;
  try {
    const len = await client.lLen(KEY);
    if (len > 0) return;
    await addAnnouncement({
      title: "MapSky 日曆與最新消息上線",
      body: "在 App 點日曆按鈕可查看月曆，並在下方看到這裡的最新消息與活動。",
      url: "https://mapskyapp.vercel.app/",
      date: new Date().toISOString().slice(0, 10),
    });
  } catch (e) {
    console.error("ensureSeedNews", e && e.message);
  }
}

module.exports = {
  addAnnouncement,
  getAnnouncementsSince,
  listAnnouncements,
  addEvent,
  listEvents,
  ensureSeedNews,
};
