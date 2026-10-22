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
// 注意：這是「管理員手動設定」的結果，跟 school-closure.js（抓人事行政總處公告）是兩回事。
const { getRedisClient } = require("./redis-client");

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
  return { enabled: input.enabled, counties };
}

const EMPTY = () => ({ enabled: false, updatedAt: null, counties: {} });

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
  };
  await client.set(KEY, JSON.stringify(doc));
  return doc;
}

module.exports = { COUNTIES, sanitizeClosures, getClosures, saveClosures };
