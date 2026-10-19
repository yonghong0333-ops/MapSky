/**
 * 雲量觀測：從 CWA O-A0003-001 各測站 Weather（天氣現象）推估雲量百分比
 * 氣象署此資料集無獨立數值雲量欄位，依官方天氣現象描述對應雲量級距。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const OBSERVATION_DATA_ID = "O-A0003-001";
const CACHE_TTL_MS = 5 * 60 * 1000;

function getApiKey() {
  return process.env.CWA_API_KEY || "";
}

function tmpPath(name) {
  return path.join(os.tmpdir(), `nexora-weather-${name}.json`);
}
function readCache(name) {
  try {
    const raw = JSON.parse(fs.readFileSync(tmpPath(name), "utf-8"));
    if (raw && raw.fetchedAt && Date.now() - raw.fetchedAt < CACHE_TTL_MS) return raw.data;
  } catch {
    /* no cache */
  }
  return null;
}
function writeCache(name, data) {
  try {
    fs.writeFileSync(tmpPath(name), JSON.stringify({ data, fetchedAt: Date.now() }), "utf-8");
  } catch {
    /* ignore */
  }
}

/**
 * 由天氣現象字串推估雲量 0–100
 * 對照 CWA：晴 / 多雲 / 陰 等描述
 */
function estimateCloudCover(weatherText) {
  const w = String(weatherText || "").trim();
  if (!w || w === "-99" || w === "-99.0") {
    return { cloudCoverPercent: null, cloudLabel: null, weather: null };
  }

  let percent = 50;
  let label = "多雲";

  if (/陰天|陰/.test(w) && !/多雲時陰|晴時多雲/.test(w)) {
    percent = 90;
    label = "陰";
  }
  if (/多雲時陰/.test(w)) {
    percent = 75;
    label = "多雲時陰";
  }
  if (/多雲/.test(w) && !/多雲時陰/.test(w)) {
    percent = 55;
    label = "多雲";
  }
  if (/晴時多雲|午後短暫|局部/.test(w)) {
    percent = 35;
    label = "晴時多雲";
  }
  if (/^晴$|晴天|萬里無雲|晴朗/.test(w) || (w.includes("晴") && !w.includes("多雲") && !w.includes("陰"))) {
    percent = 10;
    label = "晴";
  }
  if (/密雲|陰有雨|陰有雷/.test(w)) {
    percent = 95;
    label = "陰";
  }

  // 有雨／雷不完全等於全陰，但通常偏高雲量
  if (/雨|雷|雹|雪/.test(w) && percent < 70) {
    percent = Math.min(95, percent + 20);
  }

  return {
    cloudCoverPercent: percent,
    cloudLabel: label,
    weather: w,
  };
}

async function getCloudObservation({ forceRefresh = false, county = null } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, reason: "no-api-key" };

  const cacheKey = "cloud-obs";
  if (!forceRefresh) {
    const cached = readCache(cacheKey);
    if (cached) {
      const payload = { ok: true, ...cached, cached: true };
      if (county) {
        const c = String(county).replace(/台/g, "臺");
        return {
          ok: true,
          cached: true,
          updatedAt: cached.updatedAt,
          observedAt: cached.observedAt,
          source: cached.source,
          county: c,
          item: (cached.counties && cached.counties[c]) || null,
        };
      }
      return payload;
    }
  }

  const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${OBSERVATION_DATA_ID}?Authorization=${encodeURIComponent(apiKey)}&format=JSON`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.success === "false" || data.success === false) {
    throw new Error(data.message || "查詢雲量觀測失敗");
  }

  const stations = (data.records && data.records.Station) || [];
  const byCounty = {};
  let latestObs = null;

  for (const s of stations) {
    const countyName = s.GeoInfo && s.GeoInfo.CountyName;
    if (!countyName) continue;
    const we = s.WeatherElement || {};
    const weatherText = we.Weather != null ? String(we.Weather) : "";
    const est = estimateCloudCover(weatherText);
    if (est.cloudCoverPercent == null) continue;

    const isOfficial = /^\d{6}$/.test(s.StationId || "");
    const existing = byCounty[countyName];
    if (existing && existing.isOfficial && !isOfficial) continue;

    const obsTime = s.ObsTime && s.ObsTime.DateTime;
    if (obsTime && (!latestObs || obsTime > latestObs)) latestObs = obsTime;

    byCounty[countyName] = {
      stationName: s.StationName,
      stationId: s.StationId,
      cloudCoverPercent: est.cloudCoverPercent,
      cloudLabel: est.cloudLabel,
      weather: est.weather,
      visibility: we.VisibilityDescription != null ? String(we.VisibilityDescription) : null,
      obsTime: obsTime || null,
      isOfficial,
    };
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    observedAt: latestObs,
    source: OBSERVATION_DATA_ID,
    unit: "percent",
    note: "由測站天氣現象推估雲量（CWA 無獨立數值雲量欄位）",
    counties: byCounty,
  };
  writeCache(cacheKey, payload);

  if (county) {
    const c = String(county).replace(/台/g, "臺");
    return {
      ok: true,
      cached: false,
      updatedAt: payload.updatedAt,
      observedAt: payload.observedAt,
      source: payload.source,
      unit: payload.unit,
      county: c,
      item: byCounty[c] || null,
    };
  }

  return { ok: true, ...payload, cached: false };
}

module.exports = {
  getCloudObservation,
  estimateCloudCover,
};
