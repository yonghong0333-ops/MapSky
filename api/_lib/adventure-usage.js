// 「動態島冒險」每人每天的使用時間累計 —— 跟其他設定一樣存在 Redis。
//
// 規則：
// - 一天從台灣時間 05:00 開始算，隔天 05:00 歸零（半夜 0～5 點還算前一天）。
// - 每次按「開始使用」先把選的分鐘數「預扣」進今天的累計，超過上限就拒絕。
// - 提早按「結束使用」的話，把沒用完的分鐘退回去（實際用了多久算多久，
//   最少算 1 分鐘）；沒按結束（App 被滑掉等等）就維持整段都算，保守起見。
// - 每天上限是多少分鐘由後台設定（app-settings.js），這裡不決定。
// - Redis 沒設定或壞掉時一律放行（不擋人），只是那次不會被記錄。
const { getRedisClient } = require("./redis-client");

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000; // 台灣沒有日光節約時間
const DAY_START_HOUR = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SESSION_MINUTES = 480; // 單次最長 8 小時（跟網頁端 ADV_DURATION_MAX 一致，也是 Live Activity 的上限）
const HOUR_MS = 60 * 60 * 1000;

// 把時間往回撥 5 小時再取「台灣日期」，05:00 之前就會落在前一天。
function shiftedTaipeiMs(now) {
  return now + TAIPEI_OFFSET_MS - DAY_START_HOUR * HOUR_MS;
}

function dayKey(now = Date.now()) {
  return new Date(shiftedTaipeiMs(now)).toISOString().slice(0, 10);
}

// 下一次歸零（台灣 05:00）的時間點，回傳 UTC 毫秒。
function nextResetMs(now = Date.now()) {
  const shifted = shiftedTaipeiMs(now);
  const nextShiftedMidnight = Math.floor(shifted / DAY_MS) * DAY_MS + DAY_MS;
  return nextShiftedMidnight - TAIPEI_OFFSET_MS + DAY_START_HOUR * HOUR_MS;
}

function sessionKey(payload) {
  if (!payload || !payload.provider || !payload.profile || !payload.profile.id) return null;
  return `${payload.provider}:${payload.profile.id}`;
}

function usageRedisKey(key, day) {
  return `adventure:usage:${key}:${day}`;
}

function activeRedisKey(key) {
  return `adventure:active:${key}`;
}

function summarize(limit, used, now) {
  const safeUsed = Math.max(0, used);
  return {
    limit,
    used: safeUsed,
    remaining: Math.max(0, limit - safeUsed),
    resetAt: new Date(nextResetMs(now)).toISOString(),
  };
}

async function getUsage(payload, limit) {
  const now = Date.now();
  const key = sessionKey(payload);
  try {
    const client = await getRedisClient();
    if (!client || !key) return { ...summarize(limit, 0, now), tracked: false };
    const raw = await client.get(usageRedisKey(key, dayKey(now)));
    return { ...summarize(limit, Number(raw) || 0, now), tracked: true };
  } catch {
    return { ...summarize(limit, 0, now), tracked: false };
  }
}

// 上一段如果還沒按結束（例如 App 被滑掉後又重開、直接開新的一段），先把它結算掉：
// 實際用了多久算多久，多預扣的退回去。
async function settleActive(client, key, now) {
  const raw = await client.get(activeRedisKey(key));
  if (!raw) return;
  await client.del(activeRedisKey(key));
  let active;
  try { active = JSON.parse(raw); } catch { return; }
  if (!active || !active.startedAt || !active.minutes) return;
  if (active.dayKey !== dayKey(now)) return; // 跨過 05:00 了，昨天那份不用再動
  const elapsed = Math.min(active.minutes, Math.max(1, Math.ceil((now - active.startedAt) / 60000)));
  const refund = active.minutes - elapsed;
  if (refund > 0) {
    const usageKey = usageRedisKey(key, active.dayKey);
    const after = await client.decrBy(usageKey, refund);
    if (after < 0) await client.set(usageKey, "0", { KEEPTTL: true });
  }
}

// 開始一段：先預扣，超過就退回並拒絕。
async function startSession(payload, minutes, limit) {
  const now = Date.now();
  const key = sessionKey(payload);
  const want = Math.round(Number(minutes));
  if (!Number.isFinite(want) || want <= 0 || want > MAX_SESSION_MINUTES) {
    return { ok: false, reason: "bad-minutes", ...summarize(limit, 0, now) };
  }
  try {
    const client = await getRedisClient();
    if (!client || !key) return { ok: true, tracked: false, ...summarize(limit, 0, now) };

    await settleActive(client, key, now);

    const day = dayKey(now);
    const usageKey = usageRedisKey(key, day);
    const after = await client.incrBy(usageKey, want);
    await client.expire(usageKey, 3 * 24 * 60 * 60); // 幾天後自己清掉，不用手動維護
    if (after > limit) {
      await client.decrBy(usageKey, want); // 超過上限，把剛剛預扣的退回去
      const raw = await client.get(usageKey);
      return { ok: false, reason: "daily-limit", tracked: true, ...summarize(limit, Number(raw) || 0, now) };
    }
    await client.set(
      activeRedisKey(key),
      JSON.stringify({ startedAt: now, minutes: want, dayKey: day }),
      { EX: 24 * 60 * 60 }
    );
    return { ok: true, tracked: true, ...summarize(limit, after, now) };
  } catch {
    return { ok: true, tracked: false, ...summarize(limit, 0, now) };
  }
}

// 結束一段：沒用完的分鐘退回。
async function endSession(payload, limit) {
  const now = Date.now();
  const key = sessionKey(payload);
  try {
    const client = await getRedisClient();
    if (!client || !key) return { ok: true, tracked: false, ...summarize(limit, 0, now) };
    await settleActive(client, key, now);
    const raw = await client.get(usageRedisKey(key, dayKey(now)));
    return { ok: true, tracked: true, ...summarize(limit, Number(raw) || 0, now) };
  } catch {
    return { ok: true, tracked: false, ...summarize(limit, 0, now) };
  }
}

module.exports = { dayKey, nextResetMs, getUsage, startSession, endSession };
