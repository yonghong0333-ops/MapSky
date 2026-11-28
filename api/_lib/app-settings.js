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

// 「動態島冒險」每人每天可用的總分鐘數上限（每天 05:00 台灣時間刷新）。
// - 預設上限：settings:adventure_daily_limit_minutes（立即生效）
// - 多日排程：settings:adventure_daily_limit_schedules
//   格式 [{ "date": "YYYY-MM-DD", "minutes": 480 }, ...]
//   date 為台灣時間「冒險日」（該日 05:00 起算的那一天）
const DEFAULT_ADVENTURE_DAILY_LIMIT_MINUTES = 180;
const ADVENTURE_DAILY_LIMIT_KEY = "settings:adventure_daily_limit_minutes";
const ADVENTURE_SCHEDULES_KEY = "settings:adventure_daily_limit_schedules";
// 舊版單一排程 key，讀取時會遷移到 schedules
const ADVENTURE_DAILY_LIMIT_SCHEDULE_KEY = "settings:adventure_daily_limit_schedule";

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_START_HOUR = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** 台灣時間冒險日字串 YYYY-MM-DD（05:00 換日） */
function adventureDayString(now = Date.now()) {
  const shifted = now + TAIPEI_OFFSET_MS - DAY_START_HOUR * HOUR_MS;
  const d = new Date(shifted);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function next0500Ms(now = Date.now()) {
  const shifted = now + TAIPEI_OFFSET_MS - DAY_START_HOUR * HOUR_MS;
  const nextShiftedMidnight = Math.floor(shifted / DAY_MS) * DAY_MS + DAY_MS;
  return nextShiftedMidnight - TAIPEI_OFFSET_MS + DAY_START_HOUR * HOUR_MS;
}

function next0500DateString(now = Date.now()) {
  return adventureDayString(next0500Ms(now));
}

function clampMinutes(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < 0 || v > 1440) throw new Error("分鐘數需為 0～1440 的整數");
  return v;
}

function normalizeDate(dateStr) {
  const s = String(dateStr || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("日期格式需為 YYYY-MM-DD");
  return s;
}

async function readSchedules(client) {
  if (!client) return [];
  try {
    const legacy = await client.get(ADVENTURE_DAILY_LIMIT_SCHEDULE_KEY);
    if (legacy) {
      try {
        const sched = JSON.parse(legacy);
        if (sched && Number.isFinite(sched.minutes) && Number.isFinite(sched.effectiveAt)) {
          const date = adventureDayString(sched.effectiveAt);
          const list = await readSchedulesRaw(client);
          if (!list.some((x) => x.date === date)) {
            list.push({ date, minutes: Math.round(sched.minutes) });
            list.sort((a, b) => a.date.localeCompare(b.date));
            await client.set(ADVENTURE_SCHEDULES_KEY, JSON.stringify(list));
          }
        }
      } catch (_) {}
      try { await client.del(ADVENTURE_DAILY_LIMIT_SCHEDULE_KEY); } catch (_) {}
    }
  } catch (_) {}
  return readSchedulesRaw(client);
}

async function readSchedulesRaw(client) {
  try {
    const raw = await client.get(ADVENTURE_SCHEDULES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.date === "string" && Number.isFinite(Number(x.minutes)))
      .map((x) => ({ date: String(x.date), minutes: Math.round(Number(x.minutes)) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

async function writeSchedules(client, list) {
  const cleaned = (list || [])
    .filter((x) => x && x.date && Number.isFinite(x.minutes))
    .map((x) => ({ date: String(x.date), minutes: Math.round(x.minutes) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  await client.set(ADVENTURE_SCHEDULES_KEY, JSON.stringify(cleaned));
  return cleaned;
}

/** 讀取今日（冒險日）有效上限：有排程用排程，否則用預設 */
async function getAdventureDailyLimitMinutes() {
  try {
    const client = await getRedisClient();
    if (!client) return DEFAULT_ADVENTURE_DAILY_LIMIT_MINUTES;
    const today = adventureDayString();
    const schedules = await readSchedules(client);
    const hit = schedules.find((x) => x.date === today);
    if (hit) return hit.minutes;
    const raw = await client.get(ADVENTURE_DAILY_LIMIT_KEY);
    const n = raw === null || raw === undefined ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_ADVENTURE_DAILY_LIMIT_MINUTES;
  } catch {
    return DEFAULT_ADVENTURE_DAILY_LIMIT_MINUTES;
  }
}

/** 設預設上限（立即影響「沒有當日排程」的日子） */
async function setAdventureDailyLimitMinutes(minutes, options = {}) {
  const client = await getRedisClient();
  if (!client) throw new Error("尚未設定 Redis，無法儲存設定");
  const n = clampMinutes(minutes);

  const schedule = options && options.schedule;
  if (schedule === "next-0500") {
    const date = next0500DateString();
    return setAdventureSchedule(date, n);
  }
  if (options && options.date) {
    return setAdventureSchedule(options.date, n);
  }

  await client.set(ADVENTURE_DAILY_LIMIT_KEY, String(n));
  return { minutes: n, scheduled: false };
}

/** 新增／更新某一冒險日的上限 */
async function setAdventureSchedule(dateStr, minutes) {
  const client = await getRedisClient();
  if (!client) throw new Error("尚未設定 Redis，無法儲存設定");
  const date = normalizeDate(dateStr);
  const n = clampMinutes(minutes);
  const list = await readSchedules(client);
  const idx = list.findIndex((x) => x.date === date);
  if (idx >= 0) list[idx] = { date, minutes: n };
  else list.push({ date, minutes: n });
  const saved = await writeSchedules(client, list);
  return {
    minutes: n,
    scheduled: true,
    date,
    schedules: saved,
    schedule: "date",
  };
}

/** 刪除某一冒險日的排程 */
async function removeAdventureSchedule(dateStr) {
  const client = await getRedisClient();
  if (!client) throw new Error("尚未設定 Redis，無法儲存設定");
  const date = normalizeDate(dateStr);
  const list = await readSchedules(client);
  const saved = await writeSchedules(client, list.filter((x) => x.date !== date));
  return { ok: true, date, schedules: saved };
}

/** 列出未來（含今天）排程；可選清掉過期 */
async function getAdventureDailyLimitSchedules() {
  try {
    const client = await getRedisClient();
    if (!client) return [];
    const today = adventureDayString();
    let list = await readSchedules(client);
    const pruned = list.filter((x) => x.date >= today);
    if (pruned.length !== list.length) {
      list = await writeSchedules(client, pruned);
    }
    return list;
  } catch {
    return [];
  }
}

/** 相容舊呼叫：回傳最近一筆排程或 null */
async function getAdventureDailyLimitSchedule() {
  const list = await getAdventureDailyLimitSchedules();
  if (!list.length) return null;
  const first = list[0];
  return {
    minutes: first.minutes,
    date: first.date,
    schedule: "date",
    effectiveAt: null,
  };
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
  setAdventureSchedule,
  removeAdventureSchedule,
  getAdventureDailyLimitSchedules,
  getAdventureDailyLimitSchedule,
  adventureDayString,
  isMaintenanceMode,
  setMaintenanceMode,
};
