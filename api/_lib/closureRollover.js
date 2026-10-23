// 停班停課：每天臺北時間 16:00 換成隔天的；已提早公告隔天的縣市不換。
// 純函式，不碰 Redis／網路，方便接進 api/_lib/closures.js（mergeClosures 之前）。
//
// 資料形狀（人事行政總處那一份，merge 之前）：
//   counties = { "高雄市": { status: "closed", districts: {...}, note: "...", forDate: "2026-10-23" }, ... }
// forDate = 這筆狀態是哪一天的（臺北時間 yyyy-MM-dd）。

const TZ = 'Asia/Taipei';

function parts(now) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const o = Object.fromEntries(f.map((p) => [p.type, p.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, hour: Number(o.hour) };
}

/** 臺北時間的今天 "yyyy-MM-dd" */
function taipeiToday(now = new Date()) { return parts(now).date; }

/** 臺北時間的隔天 "yyyy-MM-dd" */
function taipeiTomorrow(now = new Date()) {
  const [y, m, d] = taipeiToday(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * 現在該不該跑「換成隔天」：臺北時間 16:00 之後，而且今天還沒換過。
 * lastRolloverFor = 上次換日換到的日期（存在 Redis，例如 settings:closures:rolloverFor）。
 * cron 漏跑時，下一次任何請求／cron 進來也會補上。
 */
function shouldRollover(now, lastRolloverFor) {
  return parts(now).hour >= 16 && lastRolloverFor !== taipeiTomorrow(now);
}

/**
 * 換成隔天。
 *  stored         目前存的縣市（含 forDate）
 *  dgpaTomorrow   剛抓到的人事行政總處「隔天」結果（縣市 → { status, districts, note }）；抓不到傳 null
 * 規則：
 *  ‧ stored[縣市].forDate 已經是隔天（提早公告過）→ 不動
 *  ‧ 否則有隔天的公告 → 換成隔天的，forDate = 隔天
 *  ‧ 否則（隔天沒公告）→ 移除，不把今天的停課帶到隔天
 * 抓取失敗（dgpaTomorrow === null）時什麼都不換，回傳原樣，等下次再試。
 */
function rolloverCounties(stored, dgpaTomorrow, now = new Date()) {
  if (!dgpaTomorrow) return { counties: stored, changed: [], kept: [], failed: true };
  const tomorrow = taipeiTomorrow(now);
  const out = {};
  const changed = [], kept = [];
  const names = new Set([...Object.keys(stored || {}), ...Object.keys(dgpaTomorrow)]);
  for (const name of names) {
    const cur = stored?.[name];
    if (cur && cur.forDate === tomorrow) { out[name] = cur; kept.push(name); continue; }
    const next = dgpaTomorrow[name];
    if (next) { out[name] = { ...next, forDate: tomorrow }; changed.push(name); }
  }
  return { counties: out, changed, kept, failed: false };
}

/**
 * 一般（任何時間）抓到人事行政總處時：如果某縣市公告的是隔天的，就標上 forDate，
 * 這樣 16:00 換日時才知道它「已提早公告」。announced = { 縣市: "yyyy-MM-dd" }（公告的適用日）
 */
function stampForDate(counties, announced, now = new Date()) {
  const today = taipeiToday(now);
  const out = {};
  for (const [name, c] of Object.entries(counties || {})) {
    out[name] = { ...c, forDate: announced?.[name] || c.forDate || today };
  }
  return out;
}

module.exports = { taipeiToday, taipeiTomorrow, shouldRollover, rolloverCounties, stampForDate };
