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
// 也可排程到「下一個台灣時間 05:00」生效（schedule: "next-0500"）。
const DEFAULT_ADVENTURE_DAILY_LIMIT_MINUTES = 180;
const ADVENTURE_DAILY_LIMIT_KEY = "settings:adventure_daily_limit_minutes";
const ADVENTURE_DAILY_LIMIT_SCHEDULE_KEY = "settings:adventure_daily_limit_schedule";

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_START_HOUR = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function next0500Ms(now = Date.now()) {
  const shifted = now + TAIPEI_OFFSET_MS - DAY_START_HOUR * HOUR_MS;
  const nextShiftedMidnight = Math.floor(shifted / DAY_MS) * DAY_MS + DAY_MS;
  return nextShiftedMidnight - TAIPEI_OFFSET_MS + DAY_START_HOUR * HOUR_MS;
}

async function applyScheduledAdventureLimitIfDue(client) {
  if (!client) return;
  try {
    const raw = await client.get(ADVENTURE_DAILY_LIMIT_SCHEDULE_KEY);
    if (!raw) return;
    let sched;
    try { sched = JSON.parse(raw); } catch { return; }
    if (!sched || !Number.isFinite(sched.minutes) || !Number.isFinite(sched.effectiveAt)) return;
    if (Date.now() < sched.effectiveAt) return;
    await client.set(ADVENTURE_DAILY_LIMIT_KEY, String(Math.round(sched.minutes)));
    await client.del(ADVENTURE_DAILY_LIMIT_SCHEDULE_KEY);
  } catch {
    // ignore
  }
}

async function getAdventureDailyLimitMinutes() {
  try {
    const client = await getRedisClient();
    if (!client) return DEFAULT_ADVENTURE_DAILY_LIMIT_MINUTES;
    await applyScheduledAdventureLimitIfDue(client);
    const raw = await client.get(ADVENTURE_DAILY_LIMIT_KEY);
    const n = raw === null || raw === undefined ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_ADVENTURE_DAILY_LIMIT_MINUTES;
  } catch {
    return DEFAULT_ADVENTURE_DAILY_LIMIT_MINUTES;
  }
}

async function setAdventureDailyLimitMinutes(minutes, options = {}) {
  const client = await getRedisClient();
  if (!client) throw new Error("尚未設定 Redis，無法儲存設定");
  const n = Math.round(Number(minutes));
  if (!Number.isFinite(n) || n < 0 || n > 1440) throw new Error("分鐘數需為 0～1440 的整數");

  const schedule = options && options.schedule;
  if (schedule === "next-0500") {
    const effectiveAt = next0500Ms();
    await client.set(
      ADVENTURE_DAILY_LIMIT_SCHEDULE_KEY,
      JSON.stringify({ minutes: n, effectiveAt, timezone: "Asia/Taipei" })
    );
    return {
      minutes: n,
      scheduled: true,
      effectiveAt: new Date(effectiveAt).toISOString(),
      schedule: "next-0500",
    };
  }

  await client.set(ADVENTURE_DAILY_LIMIT_KEY, String(n));
  try { await client.del(ADVENTURE_DAILY_LIMIT_SCHEDULE_KEY); } catch (_) {}
  return { minutes: n, scheduled: false };
}

async function getAdventureDailyLimitSchedule() {
  try {
    const client = await getRedisClient();
    if (!client) return null;
    await applyScheduledAdventureLimitIfDue(client);
    const raw = await client.get(ADVENTURE_DAILY_LIMIT_SCHEDULE_KEY);
    if (!raw) return null;
    const sched = JSON.parse(raw);
    if (!sched || !Number.isFinite(sched.minutes) || !Number.isFinite(sched.effectiveAt)) return null;
    return {
      minutes: sched.minutes,
      effectiveAt: new Date(sched.effectiveAt).toISOString(),
      schedule: "next-0500",
    };
  } catch {
    return null;
  }
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
  getAdventureDailyLimitSchedule,
  isMaintenanceMode,
  setMaintenanceMode,
};
