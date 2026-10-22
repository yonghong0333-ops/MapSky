/**
 * 天然災害停班停課 — 行政院人事行政總處 (DGPA)
 * 來源：https://www.dgpa.gov.tw/typh/daily/nds.html
 *
 * type 用法（經 wind 或 /api/weather/suspension）：
 *   ?type=suspension
 *   ?type=suspension&county=高雄市
 *   ?day=today|tomorrow|all
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

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
  if (/尚未列入警戒區|尚無訊息|無停班停課訊息/.test(t)) {
    work = "unknown";
    school = "unknown";
  }
  return { work, school, text: t.trim() };
}

function emptyDay() {
  return { work: "normal", school: "normal", text: "照常上班、照常上課" };
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
      i.tomorrow.school !== "normal" ||
      (i.notes && i.notes.length)
  );

  return {
    ok: true,
    updatedAt,
    source: "dgpa",
    sourceUrl: SOURCE_URL,
    sourceName: "行政院人事行政總處",
    hasAnySuspension: hasAny,
    message: hasAny ? "已有縣市發布停班停課" : "目前各縣市照常上班上課",
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
  if (d === "today" || d === "今日") {
    items = items.map((i) => ({
      county: i.county,
      status: i.today,
      notes: i.notes,
    }));
  } else if (d === "tomorrow" || d === "明日" || d === "明天") {
    items = items.map((i) => ({
      county: i.county,
      status: i.tomorrow,
      notes: i.notes,
    }));
  }
  return {
    ...payload,
    count: items.length,
    items,
    county: county ? normalizeCounty(county) : null,
    day: d === "today" || d === "tomorrow" || d === "明日" || d === "明天" || d === "今日" ? (d === "明日" || d === "明天" ? "tomorrow" : d === "今日" ? "today" : d) : "all",
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
    };
  }
  const raw = await fetchNds();
  return filterPayload(raw, {
    county: q.county || q.city || q.region || null,
    day: q.day || q.date || "all",
  });
}

module.exports = {
  classifyPhrase,
  handleSuspensionQuery,
  fetchNds,
  parseNdsHtml,
  COUNTIES,
  SOURCE_URL,
};
