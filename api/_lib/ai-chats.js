// AI 對話紀錄：依登入帳號存在 Redis，方便多裝置同步。
// key: ai:chats:{provider}:{userId}  → JSON 陣列
// 每筆：{ id, title, updatedAt, messages: [{ role, text }] }
const { getRedisClient } = require("./redis-client");

const MAX_CHATS = 40;
const MAX_MESSAGES = 60;

function chatKey(provider, id) {
  return `ai:chats:${provider}:${id}`;
}

function userKeyFromPayload(payload) {
  if (!payload) return null;
  const provider = payload.provider || "unknown";
  const id =
    (payload.profile && payload.profile.id) ||
    payload.sub ||
    payload.userId ||
    payload.id ||
    null;
  if (!id) return null;
  return { provider, id };
}

async function listChats(provider, id) {
  const client = await getRedisClient().catch(() => null);
  if (!client) return [];
  try {
    const raw = await client.get(chatKey(provider, id));
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .map((c) => ({
        id: c.id,
        title: c.title || "新對話",
        updatedAt: c.updatedAt || 0,
        messageCount: Array.isArray(c.messages) ? c.messages.length : 0,
      }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch {
    return [];
  }
}

async function getChat(provider, id, chatId) {
  const client = await getRedisClient().catch(() => null);
  if (!client) return null;
  try {
    const raw = await client.get(chatKey(provider, id));
    if (!raw) return null;
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return null;
    return list.find((c) => c && c.id === chatId) || null;
  } catch {
    return null;
  }
}

async function saveChat(provider, id, chat) {
  if (!chat || !chat.id) throw new Error("invalid-chat");
  const client = await getRedisClient();
  if (!client) throw new Error("redis-unavailable");

  let list = [];
  try {
    const raw = await client.get(chatKey(provider, id));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    }
  } catch {}

  const messages = Array.isArray(chat.messages)
    ? chat.messages
        .filter((m) => m && m.text)
        .slice(-MAX_MESSAGES)
        .map((m) => ({
          role: m.role === "model" ? "model" : "user",
          text: String(m.text).slice(0, 8000),
        }))
    : [];

  const title =
    (typeof chat.title === "string" && chat.title.trim()) ||
    (messages[0] && String(messages[0].text).slice(0, 40)) ||
    "新對話";

  const next = {
    id: String(chat.id),
    title: title.slice(0, 80),
    updatedAt: Date.now(),
    messages,
  };

  const idx = list.findIndex((c) => c && c.id === next.id);
  if (idx >= 0) list[idx] = next;
  else list.unshift(next);

  list = list
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_CHATS);

  await client.set(chatKey(provider, id), JSON.stringify(list));
  return {
    id: next.id,
    title: next.title,
    updatedAt: next.updatedAt,
    messageCount: next.messages.length,
  };
}

async function deleteChat(provider, id, chatId) {
  const client = await getRedisClient();
  if (!client) throw new Error("redis-unavailable");
  let list = [];
  try {
    const raw = await client.get(chatKey(provider, id));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    }
  } catch {}
  list = list.filter((c) => c && c.id !== chatId);
  await client.set(chatKey(provider, id), JSON.stringify(list));
  return true;
}

module.exports = {
  userKeyFromPayload,
  listChats,
  getChat,
  saveChat,
  deleteChat,
};
