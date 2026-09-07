// 中央氣象署 (CWA) 開放資料 —— 網頁版共用邏輯
// 移植自原本 Electron 版的 launcher/weather-backend.js 與 launcher/weather-alerts-backend.js，
// 差異：
//   1. 授權碼改讀環境變數 CWA_API_KEY（原本讀 GitHub repo 上管理員設定的一組）。
//   2. 沒有 BrowserWindow 可以推播事件，改成前端定時輪詢 /api/weather/* 即可。
//   3. 快取「盡力而為」：optionally 用 /tmp（同一個 warm serverless instance 之間可共用），
//      沒有就直接即時查詢；Vercel serverless 本來就沒有常駐 process 可以維持 setInterval 輪詢。
const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");
const Jimp = require("jimp");
const { classifyZone, ZONE_ORDER } = require("./rain-zone-classification");
const { seaAreaToCounties, landAreaToCounty } = require("./typhoon-sea-area-mapping");

const CWA_REST_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-C0032-001";
const CWA_FILEAPI_BASE = "https://opendata.cwa.gov.tw/fileapi/v1/opendataapi";
const TYPHOON_WARNING_DATA_ID = "W-C0034-001";
const RAIN_WARNING_DATA_ID = "W-C0033-003";
const TYPHOON_PROB_DATA_ID = "W-C0034-003";
const SUN_TIMES_DATA_ID = "A-B0062-001"; // 全臺各縣市日出、日沒、太陽過中天時刻
const MOON_TIMES_DATA_ID = "A-B0063-001"; // 全臺各縣市月出、月沒、月球過中天時刻
const OBSERVATION_DATA_ID = "O-A0003-001"; // 現在天氣觀測報告（自動氣象站，含即時風速）
const DIALAMOON_BASE = "https://svs.gsfc.nasa.gov/api/dialamoon"; // NASA SVS 月相圖 API

const CWA_CITIES = [
  "臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市",
  "基隆市", "新竹市", "新竹縣", "苗栗縣", "彰化縣", "南投縣",
  "雲林縣", "嘉義市", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣",
  "臺東縣", "澎湖縣", "金門縣", "連江縣",
];

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分鐘，跟原本輪詢間隔一致

function getApiKey() {
  return process.env.CWA_API_KEY || "";
}

// ---------- 小型檔案快取（/tmp，同一個 warm instance 之間可共用，冷啟動就重查）----------
function tmpPath(name) {
  return path.join(os.tmpdir(), `nexora-weather-${name}.json`);
}
function readCache(name) {
  try {
    const raw = JSON.parse(fs.readFileSync(tmpPath(name), "utf-8"));
    if (raw && raw.fetchedAt && Date.now() - raw.fetchedAt < CACHE_TTL_MS) return raw.data;
  } catch {
    /* no cache yet */
  }
  return null;
}
function writeCache(name, data) {
  try {
    fs.writeFileSync(tmpPath(name), JSON.stringify({ data, fetchedAt: Date.now() }), "utf-8");
  } catch {
    /* /tmp 不可寫就算了，不影響回應 */
  }
}

// ---------- 一般天氣預報 (F-C0032-001) ----------
async function fetchCityFromCwa(apiKey, label) {
  const url = `${CWA_REST_URL}?Authorization=${encodeURIComponent(apiKey)}&locationName=${encodeURIComponent(label)}&format=JSON`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.success === "false" || data.success === false) {
    throw new Error(data.message || "查詢失敗，請確認授權碼是否正確");
  }
  const locations = data.records && data.records.location;
  if (!locations || locations.length === 0) throw new Error("查無此縣市資料");
  return locations[0];
}

async function getCity(label, { forceRefresh = false } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, reason: "no-api-key" };
  const cacheKey = `city-${label}`;
  if (!forceRefresh) {
    const cached = readCache(cacheKey);
    if (cached) return { ok: true, data: cached, cached: true };
  }
  const data = await fetchCityFromCwa(apiKey, label);
  writeCache(cacheKey, data);
  return { ok: true, data, cached: false };
}

async function getAllCities({ forceRefresh = false } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, reason: "no-api-key" };
  if (!forceRefresh) {
    const cached = readCache("all");
    if (cached) return { ok: true, ...cached, cached: true };
  }
  const results = {};
  const errors = [];
  // 平行查詢（原 Electron 版怕瞬間高併發故意逐一間隔 150ms；網頁版單一使用者
  // 觸發頻率低很多，改成平行查詢以免 serverless function 逾時）。
  await Promise.all(
    CWA_CITIES.map(async (city) => {
      try {
        results[city] = await fetchCityFromCwa(apiKey, city);
      } catch (e) {
        errors.push(`${city}: ${e.message}`);
      }
    })
  );
  const payload = { updatedAt: new Date().toISOString(), cities: results };
  writeCache("all", payload);
  return { ok: true, ...payload, cached: false, failedCount: errors.length };
}

// ---------- 警特報 (CAP) ----------
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : null;
}
function paramsOf(infoBlock) {
  const map = {};
  const re = /<parameter>\s*<valueName>([^<]*)<\/valueName>\s*<value>([^<]*)<\/value>\s*<\/parameter>/g;
  let m;
  while ((m = re.exec(infoBlock))) map[m[1].trim()] = m[2].trim();
  return map;
}
function areasOf(infoBlock) {
  const re = /<areaDesc>([^<]*)<\/areaDesc>/g;
  const areas = [];
  let m;
  while ((m = re.exec(infoBlock))) areas.push(m[1].trim());
  return areas;
}

const RAIN_LEVEL_ORDER = ["超大豪雨", "大豪雨", "豪雨", "大雨"];
const RAIN_LEVEL_COLOR = {
  大雨: "rgb(255,255,0)",
  豪雨: "rgb(255,128,0)",
  大豪雨: "rgb(255,0,0)",
  超大豪雨: "rgb(155,48,255)",
};
function rainLevelRank(level) {
  const i = RAIN_LEVEL_ORDER.indexOf(level);
  return i === -1 ? RAIN_LEVEL_ORDER.length : i;
}

function classifyTyphoonAreas(eventText, alertTitleText, areas) {
  const label = `${eventText || ""} ${alertTitleText || ""}`;
  const isSea = label.includes("海上");
  const isLand = label.includes("陸上");
  const landCounties = new Set();
  const seaCounties = new Set();
  const seaCountyAreas = {};
  const addSeaArea = (county, areaName) => {
    if (!seaCountyAreas[county]) seaCountyAreas[county] = [];
    if (!seaCountyAreas[county].includes(areaName)) seaCountyAreas[county].push(areaName);
  };
  for (const areaName of areas || []) {
    if (isSea && !isLand) {
      seaAreaToCounties(areaName).forEach((c) => {
        seaCounties.add(c);
        addSeaArea(c, areaName);
      });
    } else if (isLand && !isSea) {
      const county = landAreaToCounty(areaName);
      if (county) landCounties.add(county);
    } else {
      const county = landAreaToCounty(areaName);
      if (county) landCounties.add(county);
      seaAreaToCounties(areaName).forEach((c) => {
        seaCounties.add(c);
        addSeaArea(c, areaName);
      });
    }
  }
  return { landCounties: Array.from(landCounties), seaCounties: Array.from(seaCounties), seaCountyAreas };
}

function normalizeAlertXml(xmlText, sourceLabel) {
  const identifier = tag(xmlText, "identifier");
  const sent = tag(xmlText, "sent");
  const status = tag(xmlText, "status");
  const msgType = tag(xmlText, "msgType");
  const infoBlocks = xmlText.match(/<info>[\s\S]*?<\/info>/g) || [];
  return infoBlocks.map((info, idx) => {
    const params = paramsOf(info);
    const areas = areasOf(info);
    const event = tag(info, "event");
    const alertTitle = params.alert_title || tag(info, "headline") || event;
    const record = {
      id: infoBlocks.length > 1 ? `${identifier}-${idx}` : identifier,
      source: sourceLabel,
      sent,
      status,
      msgType,
      isActive: msgType !== "Cancel",
      event,
      urgency: tag(info, "urgency"),
      severity: tag(info, "severity"),
      certainty: tag(info, "certainty"),
      effective: tag(info, "effective"),
      onset: tag(info, "onset"),
      expires: tag(info, "expires"),
      headline: tag(info, "headline"),
      description: tag(info, "description"),
      alertTitle,
      severityLevel: params.severity_level || tag(info, "severity"),
      color: params.website_color ? `rgb(${params.website_color})` : null,
      areas,
      areaCount: areas.length,
    };
    if (sourceLabel === "typhoon") {
      const { landCounties, seaCounties, seaCountyAreas } = classifyTyphoonAreas(event, alertTitle, areas);
      record.landCounties = landCounties;
      record.seaCounties = seaCounties;
      record.seaCountyAreas = seaCountyAreas;
    }
    return record;
  });
}

function mergeRainAlertsByIdentifier(rainInfoRecords) {
  const groups = new Map();
  for (const rec of rainInfoRecords) {
    const baseId = rec.id.replace(/-\d+$/, "");
    if (!groups.has(baseId)) groups.set(baseId, []);
    groups.get(baseId).push(rec);
  }
  const byLevelThenName = (a, b) => rainLevelRank(a.level) - rainLevelRank(b.level) || a.name.localeCompare(b.name, "zh-Hant");
  const merged = [];
  for (const [baseId, records] of groups) {
    const first = records[0];
    const areasByZone = {};
    for (const rec of records) {
      const level = rec.severityLevel || rec.event || "大雨";
      const color = rec.color || RAIN_LEVEL_COLOR[level] || null;
      for (const areaName of rec.areas) {
        const zone = classifyZone(areaName);
        if (!areasByZone[zone]) areasByZone[zone] = [];
        areasByZone[zone].push({ name: areaName, level, color });
      }
    }
    for (const zone of Object.keys(areasByZone)) areasByZone[zone].sort(byLevelThenName);
    const allAreas = Object.values(areasByZone).flat();
    const highestLevel = allAreas.slice().sort((a, b) => rainLevelRank(a.level) - rainLevelRank(b.level))[0];
    const latestExpires = records.reduce((max, r) => (!max || (r.expires && r.expires > max) ? r.expires : max), null);
    const now = Date.now();
    const isExpired = latestExpires ? new Date(latestExpires).getTime() < now : false;
    merged.push({
      id: baseId,
      source: "rain",
      sent: first.sent,
      status: first.status,
      msgType: first.msgType,
      isActive: records.some((r) => r.isActive) && !isExpired,
      effective: first.effective,
      onset: first.onset,
      expires: latestExpires,
      headline: first.headline,
      description: first.description,
      alertTitle: highestLevel ? `${highestLevel.level}特報` : "大雨(豪雨)特報",
      severityLevel: highestLevel ? highestLevel.level : null,
      color: highestLevel ? highestLevel.color : null,
      areasByZone,
      areaCount: allAreas.length,
    });
  }
  return merged;
}

function buildFileApiUrl(dataId, apiKey, format) {
  return `${CWA_FILEAPI_BASE}/${dataId}?Authorization=${encodeURIComponent(apiKey)}&format=${format}`;
}

async function fetchCapAlerts(url, sourceLabel) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const xmlText = await resp.text();
  return normalizeAlertXml(xmlText, sourceLabel);
}

async function getAlerts({ forceRefresh = false } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, reason: "no-api-key" };
  if (!forceRefresh) {
    const cached = readCache("alerts");
    if (cached) return { ok: true, ...cached, cached: true };
  }

  const errors = [];
  let typhoonAlerts = [];
  let rainInfos = [];
  try {
    typhoonAlerts = await fetchCapAlerts(buildFileApiUrl(TYPHOON_WARNING_DATA_ID, apiKey, "CAP"), "typhoon");
  } catch (e) {
    errors.push(`颱風警報: ${e.message}`);
  }
  try {
    rainInfos = await fetchCapAlerts(buildFileApiUrl(RAIN_WARNING_DATA_ID, apiKey, "CAP"), "rain");
  } catch (e) {
    errors.push(`大雨(豪雨)特報: ${e.message}`);
  }

  const seenRainInfo = new Set();
  const dedupedRainInfos = rainInfos.filter((r) => {
    if (seenRainInfo.has(r.id)) return false;
    seenRainInfo.add(r.id);
    return true;
  });
  const rainAlerts = mergeRainAlertsByIdentifier(dedupedRainInfos);

  const seen = new Set();
  const deduped = [...typhoonAlerts, ...rainAlerts].filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
  const all = deduped.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return new Date(b.sent) - new Date(a.sent);
  });

  const payload = { updatedAt: new Date().toISOString(), alerts: all };
  writeCache("alerts", payload);
  return { ok: true, ...payload, cached: false, failedCount: errors.length };
}

function parseTyphoonProbabilityKml(kmlText) {
  const bands = [];
  const placemarkRe = /<Placemark>([\s\S]*?)<\/Placemark>/g;
  let m;
  while ((m = placemarkRe.exec(kmlText))) {
    const block = m[1];
    const nameMatch = block.match(/<name>([^<]*)<\/name>/);
    const coordMatch = block.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
    if (!nameMatch || !coordMatch) continue;
    const points = coordMatch[1]
      .trim()
      .split(/\s+/)
      .map((triplet) => {
        const [lng, lat] = triplet.split(",").map(Number);
        return [lng, lat];
      })
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
    bands.push({ percent: nameMatch[1].trim(), points });
  }
  const descMatch = kmlText.match(/<Folder>[\s\S]*?<description>\s*([^<]*?)\s*<\/description>/);
  return { issuedAt: descMatch ? descMatch[1].trim() : null, bands };
}

async function getTyphoonProbability({ forceRefresh = false } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, reason: "no-api-key" };
  if (!forceRefresh) {
    const cached = readCache("typhoon-prob");
    if (cached) return { ok: true, ...cached, cached: true };
  }
  try {
    const url = buildFileApiUrl(TYPHOON_PROB_DATA_ID, apiKey, "KMZ");
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    const zip = new AdmZip(buf);
    const kmlEntry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith(".kml"));
    if (!kmlEntry) throw new Error("KMZ 內找不到 .kml 檔");
    const kmlText = kmlEntry.getData().toString("utf-8");
    const { issuedAt, bands } = parseTyphoonProbabilityKml(kmlText);
    const payload = { updatedAt: new Date().toISOString(), issuedAt, hasTyphoon: bands.length > 0, bands };
    writeCache("typhoon-prob", payload);
    return { ok: true, ...payload, cached: false };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ---------- 日出日沒時刻 (A-B0062-001) ----------
// 一次撈全臺各縣市今天起的資料（這個 API 不需要縣市篩選參數，本來就會回傳
// 全部縣市），整理成 { CountyName: { SunRiseTime, SunSetTime, ... } } 方便查表。
async function getSunTimes({ forceRefresh = false } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, reason: "no-api-key" };
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `sun-${today}`;
  if (!forceRefresh) {
    const cached = readCache(cacheKey);
    if (cached) return { ok: true, ...cached, cached: true };
  }
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${SUN_TIMES_DATA_ID}?Authorization=${encodeURIComponent(apiKey)}&timeFrom=${today}&sort=Date`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.success === "false" || data.success === false) {
    throw new Error(data.message || "查詢日出日沒資料失敗，請確認授權碼是否正確");
  }
  const locations = (data.records && data.records.locations && data.records.locations.location) || [];
  const counties = {};
  for (const loc of locations) {
    const todays = (loc.time || []).find((t) => t.Date === today) || (loc.time || [])[0];
    if (loc.CountyName && todays) counties[loc.CountyName] = todays;
  }
  const payload = { updatedAt: new Date().toISOString(), date: today, counties };
  writeCache(cacheKey, payload);
  return { ok: true, ...payload, cached: false };
}

// ---------- 月出月沒時刻 (A-B0063-001) ----------
// 跟日出日沒同樣邏輯；有些日子月亮不會升起或落下，對應欄位會是空字串，
// 交給前端顯示成「--」。
async function getMoonTimes({ forceRefresh = false } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, reason: "no-api-key" };
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `moon-${today}`;
  if (!forceRefresh) {
    const cached = readCache(cacheKey);
    if (cached) return { ok: true, ...cached, cached: true };
  }
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${MOON_TIMES_DATA_ID}?Authorization=${encodeURIComponent(apiKey)}&timeFrom=${today}&sort=Date`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.success === "false" || data.success === false) {
    throw new Error(data.message || "查詢月出月沒資料失敗，請確認授權碼是否正確");
  }
  const locations = (data.records && data.records.locations && data.records.locations.location) || [];
  const counties = {};
  for (const loc of locations) {
    const todays = (loc.time || []).find((t) => t.Date === today) || (loc.time || [])[0];
    if (loc.CountyName && todays) counties[loc.CountyName] = todays;
  }
  const payload = { updatedAt: new Date().toISOString(), date: today, counties };
  writeCache(cacheKey, payload);
  return { ok: true, ...payload, cached: false };
}

// ---------- 即時風速觀測 (O-A0003-001) ----------
// 蒲氏風級（Beaufort Scale）對照表，輸入風速單位為 m/s。
const BEAUFORT_SCALE = [
  { max: 0.2, level: 0, desc: "無風" },
  { max: 1.5, level: 1, desc: "軟風" },
  { max: 3.3, level: 2, desc: "輕風" },
  { max: 5.4, level: 3, desc: "微風" },
  { max: 7.9, level: 4, desc: "和風" },
  { max: 10.7, level: 5, desc: "清風" },
  { max: 13.8, level: 6, desc: "強風" },
  { max: 17.1, level: 7, desc: "疾風" },
  { max: 20.7, level: 8, desc: "大風" },
  { max: 24.4, level: 9, desc: "烈風" },
  { max: 28.4, level: 10, desc: "狂風" },
  { max: 32.6, level: 11, desc: "暴風" },
  { max: Infinity, level: 12, desc: "颶風" },
];

function windSpeedToBeaufort(speedMs) {
  if (!Number.isFinite(speedMs) || speedMs < 0) return null;
  return BEAUFORT_SCALE.find((s) => speedMs <= s.max) || null;
}

// 一次撈全臺自動氣象站的即時觀測資料，依縣市分組。同一縣市可能有多個測站
// （正式站 + 農業站等），優先取「正式氣象站」（測站代號為 6 位數字，例如
// 466920）且風速資料有效（非 -99）者，取不到就退回任何一個有效資料的測站。
async function getWindObservation({ forceRefresh = false } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, reason: "no-api-key" };
  const cacheKey = "wind-obs";
  if (!forceRefresh) {
    const cached = readCache(cacheKey);
    if (cached) return { ok: true, ...cached, cached: true };
  }
  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${OBSERVATION_DATA_ID}?Authorization=${encodeURIComponent(apiKey)}&format=JSON`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.success === "false" || data.success === false) {
    throw new Error(data.message || "查詢即時風速觀測資料失敗，請確認授權碼是否正確");
  }
  const stations = (data.records && data.records.Station) || [];

  const byCounty = {};
  for (const s of stations) {
    const county = s.GeoInfo && s.GeoInfo.CountyName;
    if (!county) continue;
    const we = s.WeatherElement || {};
    const speed = parseFloat(we.WindSpeed);
    if (!Number.isFinite(speed) || speed < 0) continue; // -99 代表該測站暫無資料
    const isOfficial = /^\d{6}$/.test(s.StationId || "");
    const existing = byCounty[county];
    if (existing && existing.isOfficial && !isOfficial) continue; // 已有正式站資料就不覆蓋
    const beaufort = windSpeedToBeaufort(speed);
    byCounty[county] = {
      stationName: s.StationName,
      stationId: s.StationId,
      windSpeed: speed,
      windDirection: parseFloat(we.WindDirection),
      beaufortLevel: beaufort ? beaufort.level : null,
      beaufortDesc: beaufort ? beaufort.desc : null,
      obsTime: s.ObsTime && s.ObsTime.DateTime,
      isOfficial,
    };
  }

  const payload = { updatedAt: new Date().toISOString(), counties: byCounty };
  writeCache(cacheKey, payload);
  return { ok: true, ...payload, cached: false };
}

// ---------- 目前月相圖（NASA SVS Dial-A-Moon）----------
// 這支 API 不需要 CWA 授權碼，是 NASA 公開資料。抓回來的 jpg 背景是接近
// 純黑的太空背景，這裡用簡單門檻去背（背景 -> 透明），輸出成 PNG。
// 二進位內容不適合塞進原本 readCache/writeCache（那是給 JSON 用的），
// 這裡另外用一組小快取，把處理好的 PNG bytes 跟時間戳存在同一個檔案旁。
const MOON_PHASE_CACHE_TTL_MS = 30 * 60 * 1000; // NASA 圖每小時才換一張，30 分鐘夠用
const BLACK_THRESHOLD = 28; // r,g,b 都低於這個值視為背景

function readBinCache(name, ttlMs) {
  try {
    const dataPath = tmpPath(name);
    const meta = JSON.parse(fs.readFileSync(`${dataPath}.meta`, "utf-8"));
    if (meta && meta.fetchedAt && Date.now() - meta.fetchedAt < ttlMs) {
      return fs.readFileSync(dataPath);
    }
  } catch {
    /* no cache yet */
  }
  return null;
}
function writeBinCache(name, buf) {
  try {
    const dataPath = tmpPath(name);
    fs.writeFileSync(dataPath, buf);
    fs.writeFileSync(`${dataPath}.meta`, JSON.stringify({ fetchedAt: Date.now() }), "utf-8");
  } catch {
    /* /tmp 不可寫就算了，改成每次即時抓 */
  }
}

async function fetchMoonPhasePng() {
  // NASA API 要求 UTC 時間戳，格式 YYYY-MM-DDTHH:MM（會自動取最近的整點資料）
  const stamp = new Date().toISOString().slice(0, 16);
  const infoResp = await fetch(`${DIALAMOON_BASE}/${stamp}`);
  if (!infoResp.ok) throw new Error(`HTTP ${infoResp.status}`);
  const info = await infoResp.json();
  const imgUrl = info.image && info.image.url;
  if (!imgUrl) throw new Error("NASA Dial-A-Moon 回應缺少圖片網址");

  const imgResp = await fetch(imgUrl);
  if (!imgResp.ok) throw new Error(`月相圖片下載失敗 HTTP ${imgResp.status}`);
  const arrayBuf = await imgResp.arrayBuffer();

  const image = await Jimp.read(Buffer.from(arrayBuf));
  image.scan(0, 0, image.bitmap.width, image.bitmap.height, function scanPixels(x, y, idx) {
    const r = this.bitmap.data[idx];
    const g = this.bitmap.data[idx + 1];
    const b = this.bitmap.data[idx + 2];
    if (r < BLACK_THRESHOLD && g < BLACK_THRESHOLD && b < BLACK_THRESHOLD) {
      this.bitmap.data[idx + 3] = 0; // alpha = 0，去背
    }
  });
  return image.getBufferAsync(Jimp.MIME_PNG);
}

async function getMoonPhaseImage({ forceRefresh = false } = {}) {
  const cacheKey = "moon-phase-png";
  if (!forceRefresh) {
    const cached = readBinCache(cacheKey, MOON_PHASE_CACHE_TTL_MS);
    if (cached) return cached;
  }
  const buf = await fetchMoonPhasePng();
  writeBinCache(cacheKey, buf);
  return buf;
}

module.exports = {
  CWA_CITIES,
  getApiKey,
  getCity,
  getAllCities,
  getAlerts,
  getTyphoonProbability,
  getSunTimes,
  getMoonTimes,
  getWindObservation,
  windSpeedToBeaufort,
  getMoonPhaseImage,
};
