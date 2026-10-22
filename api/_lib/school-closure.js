/**
 * 天然災害停班停課 — 行政院人事行政總處 (DGPA)
 * 來源：https://www.dgpa.gov.tw/typh/daily/nds.html
 *
 * type 用法（經 wind 或 /api/weather/suspension）：
 *   ?type=suspension
 *   ?type=suspension&county=高雄市
 *   ?day=today|tomorrow|all
 *
 * 18:00（臺北）換日：見 ./closureRollover.js
 * 適用日 00:00 後仍「尚未宣布」→「未納入警戒區」（軟狀態）
 * 人事行政總處之後若有新公告 → 一律覆蓋軟狀態
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  taipeiToday,
  taipeiTomorrow,
  shouldRollover,
  rolloverCounties,
  stampForDate,
} = require("./closureRollover");

const SOURCE_URL = "https://www.dgpa.gov.tw/typh/daily/nds.html";
const CACHE_TTL_MS = 3 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;

const COUNTIES = [
  "基隆市",
  "臺北市",
  "新北市",
  "桃園市",
  "新竹市",
  "新竹縣",
  "苗栗縣",
  "臺中市",
  "彰化縣",
  "南投縣",
  "雲林縣",
  "嘉義市",
  "嘉義縣",
  "臺南市",
  "高雄市",
  "屏東縣",
  "宜蘭縣",
  "花蓮縣",
  "臺東縣",
  "澎湖縣",
  "金門縣",
  "連江縣",
];

const ALIAS = {
  台北市: "臺北市",
  台中市: "臺中市",
  台南市: "臺南市",
  台東縣: "臺東縣",
  台北: "臺北市",
  台中: "臺中市",
  台南: "臺南市",
  高雄: "高雄市",
  新北: "新北市",
  桃園: "桃園市",
  新竹: "新竹市",
  苗栗: "苗栗縣",
  彰化: "彰化縣",
  南投: "南投縣",
  雲林: "雲林縣",
  嘉義: "嘉義市",
  屏東: "屏東縣",
  宜蘭: "宜蘭縣",
  花蓮: "花蓮縣",
  台東: "臺東縣",
  澎湖: "澎湖縣",
  金門: "金門縣",
  連江: "連江縣",
  馬祖: "連江縣",
  基隆: "基隆市",
};

function tmpPath(name) {
  return path.join(os.tmpdir(), `nexora-suspension-${name}.json`);
}

function readCache(name, ttlMs, allowStaleMs) {
  try {
    const raw = JSON.parse(fs.readFileSync(tmpPath(name), "utf-8"));
    if (!raw || !raw.fetchedAt) return null;
    const age = Date.now() - raw.fetchedAt;
    if (age < ttlMs) return { data: raw.data, stale: false };
    if (allowStaleMs && age < allowStaleMs) return { data: raw.data, stale: true };
  } catch {
    /* */
  }
  return null;
}

function writeCache(name, data) {
  try {
    fs.writeFileSync(tmpPath(name), JSON.stringify({ data, fetchedAt: Date.now() }), "utf-8");
  } catch {
    /* */
  }
}

function normalizeCounty(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/台/g, "臺");
  if (COUNTIES.includes(s)) return s;
  if (ALIAS[raw] || ALIAS[s]) return ALIAS[raw] || ALIAS[s];
  const bare = s.replace(/(市|縣)$/, "");
  for (const c of COUNTIES) {
    if (c.replace(/(市|縣)$/, "") === bare) return c;
  }
  return s;
}

function classifyPhrase(text) {
  const t = String(text || "");
  const workSuspended = /停止上班/.test(t) && !/照常上班/.test(t);
  const schoolSuspended = /停止上課/.test(t) && !/照常上課/.test(t);
  const partial = /下午|晚上|中午|起停止|延後|提早/.test(t);
  let work = "normal";
  let school = "normal";
  if (workSuspended) work = partial ? "partial" : "suspended";
  if (schoolSuspended) school = partial ? "partial" : "suspended";
  if (/照常上班/.test(t)) work = "normal";
  if (/照常上課/.test(t)) school = "normal";
  if (/未納入警戒區|不納入警戒/.test(t)) {
    work = "out_of_alert";
    school = "out_of_alert";
  } else if (/尚未宣布|尚未列入警戒區|尚無訊息|無停班停課訊息/.test(t)) {
    work = "unknown";
    school = "unknown";
  }
  return { work, school, text: t.trim() };
}

function emptyDay() {
  return { work: "normal", school: "normal", text: "照常上班、照常上課" };
}

function outOfAlertDay() {
  return { work: "out_of_alert", school: "out_of_alert", text: "未納入警戒區" };
}

function isUndeclared(day) {
  if (!day) return true;
  const w = day.work || "unknown";
  const s = day.school || "unknown";
  return w === "unknown" || s === "unknown";
}

/** 可被人事行政總處新公告覆蓋的軟狀態 */
function isSoftStatus(day) {
  if (!day) return true;
  const soft = (x) => x === "unknown" || x === "out_of_alert" || x == null;
  return soft(day.work) && soft(day.school);
}

function isDgpaExplicit(day) {
  if (!day) return false;
  const w = day.work;
  return w === "suspended" || w === "partial" || w === "normal" || w === "out_of_alert";
}

/**
 * 過了適用日 forDate 的 00:00（臺北）仍「尚未宣布」→ 改成「未納入警戒區」。
 * 已設成停止／照常／部分的不改動。
 * out_of_alert 為軟狀態：下一次 DGPA 有明確公告時會被覆蓋。
 */
function expireUndeclaredDay(day, forDate, now = new Date()) {
  if (!isUndeclared(day)) return day || emptyDay();
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const o = Object.fromEntries(f.map((p) => [p.type, p.value]));
  const today = `${o.year}-${o.month}-${o.day}`;
  const applicable = forDate || today;
  if (today >= applicable) {
    return outOfAlertDay();
  }
  return day;
}

function parseDgpaUpdatedToYmd(updatedAt) {
  if (!updatedAt) return null;
  const m = String(updatedAt).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
}

function parseCountyBlock(statusHtml) {
  const plain = String(statusHtml || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\r/g, "")
    .trim();

  const notes = [];
  let todayText = "";
  let tomorrowText = "";

  const lines = plain
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (/^今天/.test(line)) {
      todayText = line.replace(/^今天/, "").replace(/^[：:\s]+/, "");
    } else if (/^明天/.test(line)) {
      tomorrowText = line.replace(/^明天/, "").replace(/^[：:\s]+/, "");
    } else if (/區[：:]/.test(line) || /鄉[：:]/.test(line) || /鎮[：:]/.test(line) || /市[：:]/.test(line)) {
      notes.push(line);
    } else if (!todayText && /停止|照常|上班|上課/.test(line)) {
      todayText = line;
    }
  }

  if (!todayText && /今天/.test(plain)) {
    const m = plain.match(/今天([^明]*)/);
    if (m) todayText = m[1].replace(/[。．]\s*$/, "").trim();
  }
  if (!tomorrowText && /明天/.test(plain)) {
    const m = plain.match(/明天(.*)$/);
    if (m) tomorrowText = m[1].replace(/[。．]\s*$/, "").trim();
  }

  return {
    today: classifyPhrase(todayText || (plain.includes("明天") ? "照常上班、照常上課" : plain)),
    tomorrow: classifyPhrase(tomorrowText || "照常上班、照常上課"),
    notes,
    raw: plain,
  };
}

function buildAllNormal(updatedAt, message) {
  return {
    ok: true,
    updatedAt,
    source: "dgpa",
    sourceUrl: SOURCE_URL,
    sourceName: "行政院人事行政總處",
    hasAnySuspension: false,
    message: message || "無停班停課訊息。",
    count: COUNTIES.length,
    items: COUNTIES.map((county) => ({
      county,
      today: emptyDay(),
      tomorrow: emptyDay(),
      notes: [],
    })),
  };
}

function parseNdsHtml(html) {
  const updateMatch =
    html.match(/更新時間[：:]\s*([0-9]{4}\/[0-9]{1,2}\/[0-9]{1,2}\s+[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)/) ||
    html.match(/更新時間[：:]\s*([^<\n]+)/);
  const updatedAt = updateMatch ? String(updateMatch[1]).trim() : null;

  if (/無停班停課訊息/.test(html)) {
    return buildAllNormal(updatedAt, "無停班停課訊息。");
  }

  const items = [];
  const rowRe =
    /<tr[^>]*>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    let name = m[1].replace(/\s+/g, "").trim();
    name = name.replace(/台/g, "臺");
    if (!COUNTIES.includes(name) && !ALIAS[name]) {
      if (/縣市名稱|是否停止/.test(name)) continue;
    }
    const county = normalizeCounty(name);
    if (!COUNTIES.includes(county)) continue;
    const block = parseCountyBlock(m[2]);
    items.push({
      county,
      today: block.today,
      tomorrow: block.tomorrow,
      notes: block.notes,
      raw: block.raw,
    });
  }

  if (!items.length) {
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ");
    for (const county of COUNTIES) {
      const idx = text.indexOf(county);
      if (idx < 0) continue;
      const slice = text.slice(idx + county.length, idx + county.length + 200);
      const block = parseCountyBlock(slice);
      items.push({
        county,
        today: block.today,
        tomorrow: block.tomorrow,
        notes: block.notes,
        raw: block.raw,
      });
    }
  }

  const seen = new Set(items.map((i) => i.county));
  for (const c of COUNTIES) {
    if (!seen.has(c)) {
      items.push({ county: c, today: emptyDay(), tomorrow: emptyDay(), notes: [] });
    }
  }
  items.sort((a, b) => COUNTIES.indexOf(a.county) - COUNTIES.indexOf(b.county));

  const hasAny = items.some(
    (i) =>
      i.today.work !== "normal" ||
      i.today.school !== "normal" ||
      i.tomorrow.work !== "normal" ||
      i.tomorrow.school !== "normal"
  );

  return {
    ok: true,
    updatedAt,
    source: "dgpa",
    sourceUrl: SOURCE_URL,
    sourceName: "行政院人事行政總處",
    hasAnySuspension: hasAny,
    message: hasAny ? null : "無停班停課訊息。",
    count: items.length,
    items,
  };
}

async function fetchNds() {
  const cached = readCache("nds", CACHE_TTL_MS, STALE_MS);
  if (cached && !cached.stale) return { ...cached.data, cached: true, stale: false };

  try {
    const resp = await fetch(SOURCE_URL, {
      headers: {
        "User-Agent": "MapSky/1.0 (+https://mapskyapp.vercel.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!resp.ok) {
      if (cached) return { ...cached.data, cached: true, stale: true, note: `上游 HTTP ${resp.status}` };
      return { ok: false, reason: "upstream-http", status: resp.status };
    }
    const html = await resp.text();
    const parsed = parseNdsHtml(html);
    writeCache("nds", parsed);
    return { ...parsed, cached: false, stale: false };
  } catch (e) {
    if (cached) return { ...cached.data, cached: true, stale: true, note: e.message };
    return { ok: false, reason: "fetch-failed", detail: String(e.message || e).slice(0, 200) };
  }
}

function filterPayload(payload, { county, day } = {}) {
  if (!payload || !payload.ok) return payload;
  let items = payload.items || [];
  if (county) {
    const c = normalizeCounty(county);
    items = items.filter((i) => i.county === c);
  }
  const d = String(day || "all").toLowerCase();
  const now = new Date();
  const fallbackYmd = parseDgpaUpdatedToYmd(payload.updatedAt);
  if (d === "today" || d === "今日") {
    items = items.map((i) => {
      const forDate = i.forDate || fallbackYmd || null;
      return {
        county: i.county,
        status: expireUndeclaredDay(i.today, forDate, now),
        forDate,
        notes: i.notes,
      };
    });
  } else if (d === "tomorrow" || d === "明日" || d === "明天") {
    items = items.map((i) => {
      const forDate = i.forDate || fallbackYmd || null;
      return {
        county: i.county,
        status: expireUndeclaredDay(i.tomorrow, forDate, now),
        forDate,
        notes: i.notes,
      };
    });
  }
  return {
    ...payload,
    count: items.length,
    items,
    county: county ? normalizeCounty(county) : null,
    day:
      d === "today" || d === "tomorrow" || d === "明日" || d === "明天" || d === "今日"
        ? d === "明日" || d === "明天"
          ? "tomorrow"
          : d === "今日"
            ? "today"
            : d
        : "all",
  };
}

function statusFromDay(day) {
  if (!day) return { status: "normal", work: "normal", school: "normal", text: "照常上班、照常上課" };
  const suspended =
    (day.work && day.work !== "normal" && day.work !== "unknown" && day.work !== "out_of_alert") ||
    (day.school && day.school !== "normal" && day.school !== "unknown" && day.school !== "out_of_alert");
  return {
    status: suspended ? "closed" : day.work === "out_of_alert" ? "out_of_alert" : "normal",
    work: day.work || "normal",
    school: day.school || "normal",
    text: day.text || "",
  };
}

function readRolloverState() {
  try {
    const raw = JSON.parse(fs.readFileSync(tmpPath("rollover-state"), "utf-8"));
    return {
      lastRolloverFor: raw.lastRolloverFor || null,
      counties: raw.counties || {},
    };
  } catch {
    return { lastRolloverFor: null, counties: {} };
  }
}

function writeRolloverState(state) {
  try {
    fs.writeFileSync(
      tmpPath("rollover-state"),
      JSON.stringify({ ...state, savedAt: new Date().toISOString() }),
      "utf-8"
    );
  } catch {
    /* ignore */
  }
}

function partsHour(now) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const o = Object.fromEntries(f.map((p) => [p.type, p.value]));
  return Number(o.hour);
}

function applyRolloverToPayload(payload, now = new Date()) {
  if (!payload || !payload.ok || !Array.isArray(payload.items)) return payload;

  const state = readRolloverState();
  const tomorrow = taipeiTomorrow(now);
  const today = taipeiToday(now);

  const dgpaTomorrow = {};
  for (const it of payload.items) {
    dgpaTomorrow[it.county] = statusFromDay(it.tomorrow);
  }

  const announced = {};
  for (const it of payload.items) {
    const t = it.tomorrow || {};
    if (
      t.work === "suspended" ||
      t.work === "partial" ||
      t.school === "suspended" ||
      t.school === "partial"
    ) {
      announced[it.county] = tomorrow;
    }
  }
  const stamped = stampForDate(
    Object.fromEntries(payload.items.map((it) => [it.county, statusFromDay(it.today)])),
    announced,
    now
  );

  let counties = { ...stamped };
  for (const [name, cur] of Object.entries(state.counties || {})) {
    if (!(cur && cur.forDate === tomorrow)) continue;
    if (isSoftStatus(cur)) continue;
    const dgpa = dgpaTomorrow[name];
    if (
      dgpa &&
      isDgpaExplicit({ work: dgpa.work, school: dgpa.school }) &&
      !isSoftStatus({ work: dgpa.work, school: dgpa.school })
    ) {
      continue;
    }
    if (cur.work === "suspended" || cur.work === "partial" || cur.status === "closed") {
      counties[name] = cur;
    } else if (cur.work === "normal" || cur.status === "normal") {
      if (!dgpa || isSoftStatus({ work: dgpa.work, school: dgpa.school })) {
        counties[name] = cur;
      }
    }
  }

  let rolled = false;
  let rolloverMeta = { attempted: false, changed: [], kept: [], failed: false };
  if (shouldRollover(now, state.lastRolloverFor)) {
    rolloverMeta.attempted = true;
    const res = rolloverCounties(counties, dgpaTomorrow, now);
    rolloverMeta.changed = res.changed || [];
    rolloverMeta.kept = res.kept || [];
    rolloverMeta.failed = Boolean(res.failed);
    if (!res.failed) {
      counties = res.counties;
      writeRolloverState({ lastRolloverFor: tomorrow, counties });
      rolled = true;
    }
  } else {
    writeRolloverState({ lastRolloverFor: state.lastRolloverFor, counties });
  }

  const afterSix =
    shouldRollover(now, null) || state.lastRolloverFor === tomorrow || rolled;
  const items = payload.items.map((it) => {
    const c = counties[it.county];
    const forDate = (c && c.forDate) || today;
    let todayStatus = it.today;
    let tomorrowStatus = it.tomorrow;
    const dgpaToday = it.today;
    const dgpaTom = it.tomorrow;

    if (afterSix && c) {
      const fromStore = {
        work:
          c.work ||
          (c.status === "closed"
            ? "suspended"
            : c.status === "out_of_alert"
              ? "out_of_alert"
              : "normal"),
        school:
          c.school ||
          (c.status === "closed"
            ? "suspended"
            : c.status === "out_of_alert"
              ? "out_of_alert"
              : "normal"),
        text:
          c.text ||
          (c.status === "closed"
            ? "停止上班、停止上課"
            : c.status === "out_of_alert"
              ? "未納入警戒區"
              : "照常上班、照常上課"),
      };
      if (dgpaToday && isDgpaExplicit(dgpaToday) && !isSoftStatus(dgpaToday)) {
        todayStatus = dgpaToday;
      } else if (isSoftStatus(fromStore) && dgpaToday && !isUndeclared(dgpaToday)) {
        todayStatus = dgpaToday;
      } else {
        todayStatus = fromStore;
      }
      if (rolled && !announced[it.county]) {
        tomorrowStatus = emptyDay();
      }
    }

    if (dgpaToday && isDgpaExplicit(dgpaToday) && !isSoftStatus(dgpaToday)) {
      todayStatus = dgpaToday;
    }
    if (dgpaTom && isDgpaExplicit(dgpaTom) && !isSoftStatus(dgpaTom)) {
      tomorrowStatus = dgpaTom;
    }

    todayStatus = expireUndeclaredDay(todayStatus, forDate, now);
    tomorrowStatus = expireUndeclaredDay(tomorrowStatus, tomorrow, now);

    return {
      ...it,
      today: todayStatus,
      tomorrow: tomorrowStatus,
      forDate,
    };
  });

  const hasAny = items.some(
    (i) =>
      (i.today &&
        i.today.work !== "normal" &&
        i.today.work !== "out_of_alert" &&
        i.today.work !== "unknown") ||
      (i.tomorrow &&
        i.tomorrow.work !== "normal" &&
        i.tomorrow.work !== "out_of_alert" &&
        i.tomorrow.work !== "unknown")
  );

  return {
    ...payload,
    items,
    hasAnySuspension: hasAny,
    rollover: {
      taipeiToday: today,
      taipeiTomorrow: tomorrow,
      lastRolloverFor: rolled ? tomorrow : state.lastRolloverFor,
      afterSix: partsHour(now) >= 18,
      rolled,
      ...rolloverMeta,
    },
  };
}

async function handleSuspensionQuery(query) {
  const q = query || {};
  const type = String(q.type || q.action || "suspension").toLowerCase();
  if (type === "usage" || type === "help") {
    return {
      ok: true,
      usage: {
        all: "?type=suspension",
        county: "?type=suspension&county=高雄市",
        today: "?type=suspension&day=today",
        tomorrow: "?type=suspension&day=tomorrow",
      },
      sourceUrl: SOURCE_URL,
      note:
        "臺北 18:00 換日；適用日 00:00 後尚未宣布 → out_of_alert。人事行政總處之後有新公告會覆蓋軟狀態。",
      statusCodes: {
        normal: "照常上班上課",
        suspended: "停止上班上課",
        partial: "部分時段",
        unknown: "尚未宣布",
        out_of_alert: "未納入警戒區（軟，可被 DGPA 覆蓋）",
      },
    };
  }
  const raw = await fetchNds();
  if (!raw || !raw.ok) return raw;
  const withRollover = applyRolloverToPayload(raw, new Date());
  return filterPayload(withRollover, {
    county: q.county || q.city || q.region || null,
    day: q.day || q.date || "all",
  });
}

module.exports = {
  handleSuspensionQuery,
  fetchNds,
  parseNdsHtml,
  applyRolloverToPayload,
  expireUndeclaredDay,
  outOfAlertDay,
  COUNTIES,
  SOURCE_URL,
};
