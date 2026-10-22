// 停班停課（後台手動設定）—— 存在 Redis，改完立刻生效，不用重新部署。
//
// 資料格式（GET 回傳、POST 儲存都是這個）：
//   {
//     enabled: true,                              // 後台總開關；false 時前台不顯示
//     updatedAt: "2026-10-22T04:30:00.000Z",      // 由這裡在儲存時寫入
//     counties: {
//       "高雄市": { status: "normal", districts: { "那瑪夏區": "closed" } },
//       "屏東縣": { status: "closed" }
//     }
//   }
// status：closed＝停止上班上課、normal＝正常上班上課、none＝未納入警戒區。
// 沒出現在 counties 的縣市等於 none；districts 裡的行政區覆蓋縣市的狀態，沒列的沿用縣市。
//
// 手動設定 vs. 人事行政總處（school-closure.js 抓的公告）怎麼合併，見 mergeClosures()：
//   ・管理員沒開「手動設定」或沒填某縣市 → 自動用人事行政總處的
//   ・管理員填了，但跟人事行政總處不一樣 → 用人事行政總處的，
//     除非管理員在那個縣市／行政區按了「以我為準」（存在 overrides：["高雄市", "高雄市/那瑪夏區"]）
//   ・人事行政總處沒表態（尚未列入警戒區、抓不到）→ 用管理員填的
const { getRedisClient } = require("./redis-client");
const { fetchNds, classifyPhrase } = require("./school-closure");

const KEY = "settings:closures";
const MAX_BODY_CHARS = 200000;

const COUNTIES = [
  "臺北市", "新北市", "基隆市", "桃園市", "新竹市", "新竹縣", "苗栗縣", "臺中市", "彰化縣", "南投縣", "雲林縣",
  "嘉義市", "嘉義縣", "臺南市", "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣",
];
const STATUSES = new Set(["closed", "normal", "none"]);

function fail(reason) {
  const e = new Error(reason);
  e.reason = reason;
  return e;
}

function normName(s) {
  return String(s == null ? "" : s).replace(/台/g, "臺").trim();
}

// 檢查＋整理前端送來的內容；格式不對丟 Error（e.reason 是給前端的代碼）
function sanitizeClosures(input) {
  if (!input || typeof input !== "object") throw fail("invalid-body");
  if (typeof input.enabled !== "boolean") throw fail("invalid-body");
  if (input.counties != null && (typeof input.counties !== "object" || Array.isArray(input.counties))) throw fail("invalid-body");
  if (JSON.stringify(input).length > MAX_BODY_CHARS) throw fail("too-large");

  const counties = {};
  for (const [rawName, c] of Object.entries(input.counties || {})) {
    const name = normName(rawName);
    if (!COUNTIES.includes(name)) throw fail("invalid-county");
    if (!c || typeof c !== "object") throw fail("invalid-body");
    if (!STATUSES.has(c.status)) throw fail("invalid-status");
    const out = { status: c.status };
    if (c.districts != null) {
      if (typeof c.districts !== "object" || Array.isArray(c.districts)) throw fail("invalid-body");
      const ds = {};
      for (const [rawD, s] of Object.entries(c.districts)) {
        const d = normName(rawD);
        if (!d || d.length > 20) throw fail("invalid-district");
        if (!STATUSES.has(s)) throw fail("invalid-status");
        if (s !== c.status) ds[d] = s; // 跟縣市一樣的不用存
      }
      if (Object.keys(ds).length) out.districts = ds;
    }
    // 沒有任何設定的縣市不存
    if (out.status !== "none" || out.districts) counties[name] = out;
  }

  // 「以我為準」：縣市，或「縣市/行政區」
  const overrides = [];
  if (input.overrides != null) {
    if (!Array.isArray(input.overrides) || input.overrides.length > 1000) throw fail("invalid-body");
    for (const raw of input.overrides) {
      if (typeof raw !== "string") throw fail("invalid-body");
      const [c, d, ...rest] = raw.split("/");
      const county = normName(c);
      if (rest.length || !COUNTIES.includes(county)) throw fail("invalid-county");
      let key = county;
      if (d !== undefined) {
        const dn = normName(d);
        if (!dn || dn.length > 20) throw fail("invalid-district");
        key = county + "/" + dn;
      }
      if (!overrides.includes(key)) overrides.push(key);
    }
  }
  return { enabled: input.enabled, counties, overrides };
}

const EMPTY = () => ({ enabled: false, updatedAt: null, counties: {}, overrides: [] });

async function getClosures() {
  try {
    const client = await getRedisClient();
    if (!client) return EMPTY();
    const raw = await client.get(KEY);
    if (!raw) return EMPTY();
    const doc = JSON.parse(raw);
    return {
      enabled: doc.enabled === true,
      updatedAt: doc.updatedAt || null,
      counties: doc.counties && typeof doc.counties === "object" ? doc.counties : {},
      overrides: Array.isArray(doc.overrides) ? doc.overrides : [],
    };
  } catch {
    return EMPTY();
  }
}

// 整份取代儲存；回傳存好的內容（含 updatedAt）
async function saveClosures(input, payload) {
  const clean = sanitizeClosures(input);
  const client = await getRedisClient();
  if (!client) throw fail("redis-not-configured");
  const doc = {
    enabled: clean.enabled,
    updatedAt: new Date().toISOString(),
    updatedBy: payload && payload.provider && payload.profile ? `${payload.provider}:${payload.profile.id}` : null,
    counties: clean.counties,
    overrides: clean.overrides,
  };
  await client.set(KEY, JSON.stringify(doc));
  return doc;
}

// ---------------------------------------------------------------------------
// 人事行政總處（DGPA）→ 我們的三種狀態
// ---------------------------------------------------------------------------

// classifyPhrase 的結果 → closed / normal / null（null＝沒表態，例如「尚未列入警戒區」）
// 停止上班或停止上課任何一個（含只停半天）都算 closed；原文放在 note 讓使用者自己看。
function phraseToStatus(p) {
  if (!p) return null;
  if (p.work === "unknown" || p.school === "unknown") return null;
  if (p.work === "suspended" || p.school === "suspended" || p.work === "partial" || p.school === "partial") return "closed";
  return "normal";
}

// notes 裡像「那瑪夏區、桃源區：停止上班、停止上課」的行 → { 那瑪夏區: "closed", 桃源區: "closed" }
function parseDistrictNotes(notes) {
  const out = {};
  for (const line of notes || []) {
    const m = String(line).match(/^(.{1,80}?)[：:](.+)$/);
    if (!m) continue;
    const st = phraseToStatus(classifyPhrase(m[2]));
    if (!st) continue;
    for (const name of m[1].split(/[、，,及和與\s]+/).map((n) => normName(n)).filter(Boolean)) {
      if (/[區鄉鎮市]$/.test(name) && name.length <= 6) out[name] = st;
    }
  }
  return out;
}

// fetchNds() 的結果 → 只留「人事行政總處有表態」的縣市
//   { ok, updatedAt, stale, hasAnySuspension, counties: { 高雄市: { status?, districts?, note? } } }
// 今天、明天只要有一天停班停課就算 closed（原文寫在 note）。
function summarizeDgpa(nds) {
  if (!nds || nds.ok === false) return { ok: false, counties: {} };
  const counties = {};
  for (const it of nds.items || []) {
    if (!it.raw) continue; // 沒有原文＝補上去的預設「照常」，不算人事行政總處有表態
    const t = phraseToStatus(it.today);
    const m = phraseToStatus(it.tomorrow);
    const districts = parseDistrictNotes(it.notes);
    // 「尚未列入警戒區」這種沒表態的，今天明天都不算（解析器會把沒寫的明天預設成照常，不能當真）
    const unlisted = /尚未列入警戒區|尚無訊息|無停班停課訊息/.test(String(it.raw));
    let status = null;
    if (!unlisted) {
      if (t === "closed" || m === "closed") status = "closed";
      else if (t === "normal" || m === "normal") status = "normal";
    }
    if (!status && !Object.keys(districts).length) continue;
    const e = {};
    if (status) e.status = status;
    if (Object.keys(districts).length) e.districts = districts;
    const parts = [];
    if (it.today && it.today.work !== "unknown" && it.today.text) parts.push("今天 " + it.today.text);
    if (it.tomorrow && it.tomorrow.work !== "unknown" && it.tomorrow.text) parts.push("明天 " + it.tomorrow.text);
    if (parts.length) e.note = parts.join("；").slice(0, 160);
    counties[it.county] = e;
  }
  const hasAny = Object.values(counties).some((c) => c.status === "closed" || Object.values(c.districts || {}).includes("closed"));
  return { ok: true, updatedAt: nds.updatedAt || null, stale: Boolean(nds.stale), hasAnySuspension: hasAny, counties };
}

async function loadDgpa(timeoutMs = 6000) {
  let timer;
  try {
    const nds = await Promise.race([
      fetchNds(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); }),
    ]);
    return summarizeDgpa(nds);
  } catch {
    return { ok: false, counties: {} };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 合併：手動設定 + 人事行政總處 → 使用者實際看到的
// ---------------------------------------------------------------------------
// 回傳 { enabled, counties: { 縣市: { status, districts?, source: "manual"|"dgpa", note? } }, conflicts: [...] }
// conflicts：管理員填的跟人事行政總處不一樣、而且沒按「以我為準」的地方（這時採用人事行政總處的）。
function mergeClosures(manual, dgpa) {
  const m = manual || EMPTY();
  const useManual = m.enabled === true;
  const ov = new Set(useManual ? m.overrides || [] : []);
  const dg = dgpa && dgpa.ok ? dgpa.counties || {} : {};
  const counties = {};
  const conflicts = [];

  for (const C of COUNTIES) {
    const mc = useManual && m.counties && m.counties[C] ? m.counties[C] : null;
    const dc = dg[C] || null;
    const mcDistricts = (mc && mc.districts) || {};
    const manualDistrict = (d) => mcDistricts[d] || (mc && mc.status);

    let status = "none";
    let source = null;
    let note = null;
    let districts = {};

    if (mc && ov.has(C)) {
      // 整個縣市以管理員為準
      status = mc.status;
      districts = { ...mcDistricts };
      source = "manual";
    } else {
      if (dc && dc.status) {
        status = dc.status; // 人事行政總處有表態 → 用他的；管理員填的在這裡被忽略（除非逐區「以我為準」）
        source = "dgpa";
        note = dc.note || null;
      } else if (mc) {
        status = mc.status; // 人事行政總處沒表態 → 用管理員填的
        districts = { ...mcDistricts };
        source = "manual";
      }
      if (dc && dc.districts) {
        for (const [d, s] of Object.entries(dc.districts)) districts[d] = s;
        if (!source) source = "dgpa";
      }
      if (mc) {
        for (const key of ov) {
          if (key.startsWith(C + "/")) {
            const d = key.slice(C.length + 1);
            districts[d] = manualDistrict(d);
            source = source || "manual";
          }
        }
      }

      // 找出不一樣的地方（採用人事行政總處的那一邊）給後台顯示
      if (mc && dc) {
        // 管理員縣市層級選「未納入警戒區」只是沒表態（可能只設了某幾個行政區），跟人事行政總處的「照常」不算不一樣
        if (dc.status && mc.status !== dc.status && !(mc.status === "none" && dc.status === "normal") && !ov.has(C)) {
          conflicts.push({ county: C, manual: mc.status, dgpa: dc.status });
        }
        const names = new Set([...Object.keys(mcDistricts), ...Object.keys(dc.districts || {})]);
        for (const d of names) {
          if (ov.has(C + "/" + d)) continue;
          const mine = manualDistrict(d);
          const theirs = (dc.districts && dc.districts[d]) || dc.status;
          if (mine && theirs && mine !== theirs) {
            // 縣市層級已經因為同一個原因列過了，不重複列（行政區沿用縣市、跟縣市層級同一個不一樣）
            if (!(dc.status && !(dc.districts && dc.districts[d]) && mcDistricts[d] === undefined)) {
              conflicts.push({ county: C, district: d, manual: mine, dgpa: theirs });
            }
          }
        }
      }
    }

    for (const [d, s] of Object.entries(districts)) if (s === status) delete districts[d]; // 跟縣市一樣的不用列
    if (status !== "none" || Object.keys(districts).length) {
      const e = { status, source: source || "manual" };
      if (Object.keys(districts).length) e.districts = districts;
      if (note) e.note = note;
      counties[C] = e;
    }
  }

  const anyClosed = Object.values(counties).some((c) => c.status === "closed" || Object.values(c.districts || {}).includes("closed"));
  return { enabled: useManual || anyClosed, counties, conflicts };
}

// GET /api/weather/closures 的內容
//   一般使用者：{ ok, enabled, updatedAt, counties(合併後), dgpa }
//   管理員（?admin=1）：counties／enabled／overrides 是「手動設定原樣」（後台編輯用，存回去不會把人事行政總處的結果存成手動），
//     另外附 effective（使用者實際看到的）、conflicts、dgpa（含各縣市）。
async function getClosuresView({ admin = false, manual, dgpa } = {}) {
  const man = manual || (await getClosures());
  const dg = dgpa || (await loadDgpa());
  const merged = mergeClosures(man, dg);
  const dgMeta = { ok: Boolean(dg.ok), updatedAt: dg.updatedAt || null, stale: Boolean(dg.stale), hasAnySuspension: Boolean(dg.hasAnySuspension) };
  if (!admin) {
    return { ok: true, enabled: merged.enabled, updatedAt: man.updatedAt, counties: merged.counties, dgpa: dgMeta };
  }
  return {
    ok: true,
    enabled: man.enabled,
    updatedAt: man.updatedAt,
    counties: man.counties,
    overrides: man.overrides,
    effective: { enabled: merged.enabled, counties: merged.counties },
    conflicts: merged.conflicts,
    dgpa: { ...dgMeta, counties: dg.counties || {} },
  };
}

module.exports = {
  COUNTIES,
  sanitizeClosures,
  getClosures,
  saveClosures,
  summarizeDgpa,
  parseDistrictNotes,
  mergeClosures,
  getClosuresView,
};
