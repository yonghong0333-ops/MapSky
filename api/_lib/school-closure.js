/**
 * 天然災害停班停課 — 行政院人事行政總處 (DGPA)
 * 今天資料 forDate=今天；明天資料 forDate=明天（不可混淆）
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
const dgpaNds = require("./dgpa-nds-parse");

const SOURCE_URL = "https://www.dgpa.gov.tw/typh/daily/nds.html";
const CACHE_TTL_MS = 3 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;

const COUNTIES = dgpaNds.COUNTIES || [
  "基隆市", "臺北市", "新北市", "桃園市", "新竹市", "新竹縣", "苗栗縣",
  "臺中市", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣", "臺南市",
  "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣",
];

const ALIAS = {
  台北市: "臺北市", 台中市: "臺中市", 台南市: "臺南市", 台東縣: "臺東縣",
  台北: "臺北市", 台中: "臺中市", 台南: "臺南市", 高雄: "高雄市", 新北: "新北市",
  桃園: "桃園市", 新竹: "新竹市", 苗栗: "苗栗縣", 彰化: "彰化縣", 南投: "南投縣",
  雲林: "雲林縣", 嘉義: "嘉義市", 屏東: "屏東縣", 宜蘭: "宜蘭縣", 花蓮: "花蓮縣",
  台東: "臺東縣", 澎湖: "澎湖縣", 金門: "金門縣", 連江: "連江縣", 馬祖: "連江縣", 基隆: "基隆市",
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
  if (today >= applicable) return outOfAlertDay();
  return day;
}

function parseDgpaUpdatedToYmd(updatedAt) {
  if (!updatedAt) return null;
  const m = String(updatedAt).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
}

function parseNdsHtml(html) {
  return dgpaNds.parseNdsHtml(html);
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
  if (d === "today" || d === "今日") {
    const ymd = taipeiToday(now);
    items = items.map((i) => ({
      county: i.county,
      status: expireUndeclaredDay(i.today, ymd, now),
      forDate: ymd,
      notes: i.notes,
      districts: i.districtsToday || i.districts || {},
    }));
  } else if (d === "tomorrow" || d === "明日" || d === "明天") {
    const ymd = taipeiTomorrow(now);
    items = items.map((i) => ({
      county: i.county,
      status: expireUndeclaredDay(i.tomorrow, ymd, now),
      forDate: ymd,
      notes: i.notes,
      districts: i.districtsTomorrow || {},
    }));
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
    (day.work && day.work !== "normal" && day.work !== "unknown" && day.work !== "out_of_alert" && day.work !== "partial") ||
    (day.school && day.school !== "normal" && day.school !== "unknown" && day.school !== "out_of_alert" && day.school !== "partial");
  return {
    status: suspended
      ? "closed"
      : day.work === "partial"
        ? "partial"
        : day.work === "out_of_alert"
          ? "out_of_alert"
          : "normal",
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
    if (t.work === "suspended" || t.work === "partial" || t.school === "suspended" || t.school === "partial") {
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
    if (dgpa && isDgpaExplicit({ work: dgpa.work, school: dgpa.school }) && !isSoftStatus({ work: dgpa.work, school: dgpa.school })) {
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

  const afterSix = shouldRollover(now, null) || state.lastRolloverFor === tomorrow || rolled;
  const items = payload.items.map((it) => {
    const c = counties[it.county];
    let todayStatus = it.today;
    let tomorrowStatus = it.tomorrow;
    const dgpaToday = it.today;
    const dgpaTom = it.tomorrow;

    if (afterSix && c) {
      const fromStore = {
        work: c.work || (c.status === "closed" ? "suspended" : c.status === "out_of_alert" ? "out_of_alert" : "normal"),
        school: c.school || (c.status === "closed" ? "suspended" : c.status === "out_of_alert" ? "out_of_alert" : "normal"),
        text: c.text || (c.status === "closed" ? "停止上班、停止上課" : c.status === "out_of_alert" ? "未納入警戒區" : "照常上班、照常上課"),
      };
      if (c.forDate === tomorrow) {
        if (!(dgpaTom && isDgpaExplicit(dgpaTom) && !isSoftStatus(dgpaTom))) {
          tomorrowStatus = fromStore;
        }
      } else if (dgpaToday && isDgpaExplicit(dgpaToday) && !isSoftStatus(dgpaToday)) {
        todayStatus = dgpaToday;
      } else if (isSoftStatus(fromStore) && dgpaToday && !isUndeclared(dgpaToday)) {
        todayStatus = dgpaToday;
      } else {
        todayStatus = fromStore;
      }
      if (rolled && !announced[it.county] && !(dgpaTom && isDgpaExplicit(dgpaTom))) {
        tomorrowStatus = emptyDay();
      }
    }

    if (dgpaToday && isDgpaExplicit(dgpaToday) && !isSoftStatus(dgpaToday)) {
      todayStatus = dgpaToday;
    }
    if (dgpaTom && isDgpaExplicit(dgpaTom) && !isSoftStatus(dgpaTom)) {
      tomorrowStatus = dgpaTom;
    }

    todayStatus = expireUndeclaredDay(todayStatus, today, now);
    tomorrowStatus = expireUndeclaredDay(tomorrowStatus, tomorrow, now);

    return {
      ...it,
      today: todayStatus,
      tomorrow: tomorrowStatus,
      forDate: today,
      forDateTomorrow: tomorrow,
      districtsToday: it.districtsToday || {},
      districtsTomorrow: it.districtsTomorrow || {},
    };
  });

  const hasAny = items.some(
    (i) =>
      (i.today && i.today.work !== "normal" && i.today.work !== "out_of_alert" && i.today.work !== "unknown") ||
      (i.tomorrow && i.tomorrow.work !== "normal" && i.tomorrow.work !== "out_of_alert" && i.tomorrow.work !== "unknown")
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
      note: "today forDate=今天；tomorrow forDate=明天",
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
