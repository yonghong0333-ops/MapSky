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

// 「動態島冒險」每人每天可以使用的總分鐘數上限（每天 05:00 重新計算，見
// adventure-usage.js）。後台可以改，改完立刻生效，不用重新部署。
const DEFAULT_ADVENTURE_DAILY_LIMIT_MINUTES = 180;
const ADVENTURE_DAILY_LIMIT_KEY = "settings:adventure_daily_limit_minutes";

async function getAdventureDailyLimitMinutes() {
  try {
    const client = await getRedisClient();
    if (!client) return DEFAULT_ADVENTURE_DAILY_LIMIT_MINUTES;
    const raw = await client.get(ADVENTURE_DAILY_LIMIT_KEY);
    const n = raw === null || raw === undefined ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_ADVENTURE_DAILY_LIMIT_MINUTES;
  } catch {
    return DEFAULT_ADVENTURE_DAILY_LIMIT_MINUTES;
  }
}

async function setAdventureDailyLimitMinutes(minutes) {
  const client = await getRedisClient();
  if (!client) throw new Error("尚未設定 Redis，無法儲存設定");
  const n = Math.round(Number(minutes));
  if (!Number.isFinite(n) || n < 0 || n > 1440) throw new Error("分鐘數需為 0～1440 的整數");
  await client.set(ADVENTURE_DAILY_LIMIT_KEY, String(n));
  return n;
}

const MAINTENANCE_MODE_KEY = "settings:maintenance_mode";

async function isMaintenanceMode() {
  try {
    const client = await getRedisClient();
    if (!client) return false;
    const raw = await client.get(MAINTENANCE_MODE_KEY);
    return raw === "1";
  } catch {
    return false;
  }
}

async function setMaintenanceMode(enabled) {
  const client = await getRedisClient();
  if (!client) throw new Error("尚未設定 Redis，無法儲存設定");
  await client.set(MAINTENANCE_MODE_KEY, enabled ? "1" : "0");
  return Boolean(enabled);
}

module.exports = {
  DEFAULT_NICKNAME_COOLDOWN_DAYS,
  getNicknameCooldownDays,
  setNicknameCooldownDays,
  DEFAULT_ADVENTURE_DAILY_LIMIT_MINUTES,
  getAdventureDailyLimitMinutes,
  setAdventureDailyLimitMinutes,
  isMaintenanceMode,
  setMaintenanceMode,
};
