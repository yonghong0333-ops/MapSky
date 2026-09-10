// 一些全站共用、後台可以調整的設定值 —— 一樣存在 Redis，不用重新部署就能改。
const { getRedisClient } = require("./redis-client");

const DEFAULT_NICKNAME_COOLDOWN_DAYS = 14;
const NICKNAME_COOLDOWN_KEY = "settings:nickname_cooldown_days";

async function getNicknameCooldownDays() {
  try {
    const client = await getRedisClient();
    if (!client) return DEFAULT_NICKNAME_COOLDOWN_DAYS;
    const raw = await client.get(NICKNAME_COOLDOWN_KEY);
    const n = raw === null || raw === undefined ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_NICKNAME_COOLDOWN_DAYS;
  } catch {
    return DEFAULT_NICKNAME_COOLDOWN_DAYS;
  }
}

async function setNicknameCooldownDays(days) {
  const client = await getRedisClient();
  if (!client) throw new Error("尚未設定 Redis，無法儲存設定");
  const n = Math.max(0, Math.round(Number(days)));
  if (!Number.isFinite(n)) throw new Error("天數格式不正確");
  await client.set(NICKNAME_COOLDOWN_KEY, String(n));
  return n;
}

module.exports = {
  DEFAULT_NICKNAME_COOLDOWN_DAYS,
  getNicknameCooldownDays,
  setNicknameCooldownDays,
};
