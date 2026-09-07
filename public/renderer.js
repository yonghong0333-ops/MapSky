// ------------------------------------------------------------------
// MapSky - renderer
// 資料來源：中央氣象署 (CWA) 開放資料平臺 F-C0032-001 一般天氣預報-今明36小時天氣預報
// https://opendata.cwa.gov.tw/
// ------------------------------------------------------------------
// 注意：CWA_BASE_URL 與授權碼已移至後台（launcher/weather-backend.js），前台不再持有。
const GEOCODE_URL = "https://nominatim.openstreetmap.org/reverse";
const IP_LOCATE_URL = "https://ipwho.is/"; // GPS 抓不到位置時的備援（原生支援 HTTPS）

// CWA F-C0032-001 支援的 22 個直轄市／縣市名稱（必須完全一致才查得到資料）
const CWA_CITIES = [
  "臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市",
  "基隆市", "新竹市", "新竹縣", "苗栗縣", "彰化縣", "南投縣",
  "雲林縣", "嘉義市", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣",
  "臺東縣", "澎湖縣", "金門縣", "連江縣",
];

// 反向地理編碼（Nominatim）偶爾只給英文地區名，用簡易對照表猜測對應的 CWA 縣市名稱
const REGION_NAME_MAP = {
  taipei: "臺北市", "new taipei": "新北市", taoyuan: "桃園市",
  taichung: "臺中市", tainan: "臺南市", kaohsiung: "高雄市",
  keelung: "基隆市", hsinchu: "新竹市", miaoli: "苗栗縣",
  changhua: "彰化縣", nantou: "南投縣", yunlin: "雲林縣",
  chiayi: "嘉義市", pingtung: "屏東縣", yilan: "宜蘭縣",
  hualien: "花蓮縣", taitung: "臺東縣", penghu: "澎湖縣",
  kinmen: "金門縣", lienchiang: "連江縣", matsu: "連江縣",
};

const FAV_KEY = "weatherpro_favorites_cwa";

// 授權碼由後台（launcher/weather-backend.js，Electron main process）集中保管，
// 前台不再持有金鑰、不寫 localStorage，只透過 IPC 查詢「是否已設定」。
let apiKeyReady = false;
async function refreshApiKeyStatus() {
  const status = await window.weatherAPI.getApiKeyStatus();
  apiKeyReady = status.hasKey;
  const keyStatusEl = el("keyStatus");
  keyStatusEl.classList.toggle("disconnected", !status.hasKey);
  keyStatusEl.querySelector(".key-status-text").textContent = status.hasKey ? "已連線" : "尚未連線";
  return apiKeyReady;
}

function loadFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; }
  catch { return []; }
}
function saveFavorites(favs) { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); }

let favorites = loadFavorites();
let currentCity = null; // { label } - label 就是 CWA 縣市名稱
let selectedCompare = new Set(); // 目前勾選要比較的城市 label

const el = (id) => document.getElementById(id);
const statusText = el("statusText");
function setStatus(msg) { statusText.textContent = msg; }

// 自訂天氣圖示：檔名 -> icons/ 資料夾內對應的 PNG
const WX_ICON_FILES = {
  extremeRain: "icons/extreme-rain.png", // 超大豪雨
  heavyRain: "icons/heavy-rain.png",     // 豪雨
  drizzle: "icons/drizzle.png",          // 毛毛雨
  thunderstorm: "icons/thunderstorm.png",// 雷雨
  dryThunder: "icons/dry-thunder.png",   // 悶雷
  rain: "icons/rain.png",                // 下雨
  overcast: "icons/overcast.png",        // 陰天
  partlyCloudy: "icons/partly-cloudy.png",// 多雲時晴
  sunny: "icons/sunny.png",              // 晴天
};

function iconImg(key, altText) {
  return `<img class="wx-icon-img" src="${WX_ICON_FILES[key]}" alt="${altText}">`;
}

function iconForWx(text) {
  if (!text) return "❓";
  if (text.includes("雪")) return "❄️";       // 無對應自訂圖示，沿用 emoji
  if (text.includes("霧")) return "🌫️";       // 無對應自訂圖示，沿用 emoji
  if (text.includes("超大豪雨")) return iconImg("extremeRain", text);
  if (text.includes("豪雨")) return iconImg("heavyRain", text);
  if (text.includes("毛毛雨")) return iconImg("drizzle", text);
  if (text.includes("雷") && text.includes("雨")) return iconImg("thunderstorm", text);
  if (text.includes("雷")) return iconImg("dryThunder", text);
  if (text.includes("雨")) return iconImg("rain", text);
  if (text.includes("多雲") && text.includes("晴")) return iconImg("partlyCloudy", text);
  if (text.includes("陰")) return iconImg("overcast", text);
  if (text.includes("多雲")) return iconImg("overcast", text); // 無專屬圖示，沿用陰天圖示
  if (text.includes("晴")) return iconImg("sunny", text);
  return "🌡️";
}

function isNightTime(startTimeStr) {
  if (!startTimeStr) return false;
  const d = new Date(startTimeStr.replace(" ", "T"));
  const hour = d.getHours();
  return hour < 6 || hour >= 18;
}

function themeForWx(text, night) {
  if (!text) return "weather-cloudy-day";
  if (text.includes("雷")) return "weather-thunder";
  if (text.includes("雪")) return "weather-snow";
  if (text.includes("雨")) return "weather-rain";
  if (text.includes("霧")) return "weather-fog";
  if (text.includes("陰")) return "weather-overcast";
  if (text.includes("多雲") && text.includes("晴")) return night ? "weather-cloudy-night" : "weather-sunny-day";
  if (text.includes("多雲")) return night ? "weather-cloudy-night" : "weather-cloudy-day";
  if (text.includes("晴")) return night ? "weather-sunny-night" : "weather-sunny-day";
  return night ? "weather-cloudy-night" : "weather-cloudy-day";
}

const ALL_WEATHER_THEMES = [
  "weather-sunny-day", "weather-sunny-night", "weather-cloudy-day", "weather-cloudy-night",
  "weather-overcast", "weather-rain", "weather-thunder", "weather-fog", "weather-snow",
];

function applyWeatherBackground(wxText, startTimeStr) {
  const theme = themeForWx(wxText, isNightTime(startTimeStr));
  document.body.classList.remove(...ALL_WEATHER_THEMES);
  document.body.classList.add(theme);
}

// ---------------- City dropdown ----------------
function initCitySelect() {
  const select = el("citySelect");
  select.innerHTML = "";
  CWA_CITIES.forEach((city) => {
    const opt = document.createElement("option");
    opt.value = city;
    opt.textContent = city;
    select.appendChild(opt);
  });
}
initCitySelect();

// ---------------- Favorites UI ----------------
function renderFavorites() {
  const list = el("favList");
  list.innerHTML = "";

  // 移除已不在收藏中的比較勾選
  const favLabels = new Set(favorites.map((f) => f.label));
  selectedCompare.forEach((label) => {
    if (!favLabels.has(label)) selectedCompare.delete(label);
  });

  favorites.forEach((fav) => {
    const row = document.createElement("div");
    row.className = "fav-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedCompare.has(fav.label);
    checkbox.title = "勾選以加入多城市比較";
    checkbox.onchange = () => {
      if (checkbox.checked) selectedCompare.add(fav.label);
      else selectedCompare.delete(fav.label);
      updateCompareBtn();
    };

    const selectBtn = document.createElement("button");
    selectBtn.className = "fav-select";
    if (currentCity && currentCity.label === fav.label) selectBtn.classList.add("active");
    selectBtn.textContent = fav.label;
    selectBtn.onclick = () => selectCity(fav.label);

    const removeBtn = document.createElement("button");
    removeBtn.className = "fav-remove";
    removeBtn.textContent = "✕";
    removeBtn.onclick = () => {
      favorites = favorites.filter((f) => f.label !== fav.label);
      saveFavorites(favorites);
      selectedCompare.delete(fav.label);
      renderFavorites();
      updateCompareBtn();
    };

    row.appendChild(checkbox);
    row.appendChild(selectBtn);
    row.appendChild(removeBtn);
    list.appendChild(row);
  });

  updateCompareBtn();
}

function updateCompareBtn() {
  const btn = el("compareBtn");
  const count = selectedCompare.size;
  btn.textContent = `📊 比較所選城市 (${count})`;
  btn.classList.toggle("hidden", count < 2);
}

el("compareBtn").onclick = () => {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.querySelector('.tab-btn[data-tab="compare"]').classList.add("active");
  el("comparePanel").classList.add("active");
  renderCompareView(Array.from(selectedCompare));
};

el("addFavBtn").onclick = () => {
  if (!currentCity) return;
  if (favorites.some((f) => f.label === currentCity.label)) {
    setStatus("此城市已在收藏中");
    return;
  }
  favorites.push({ label: currentCity.label });
  saveFavorites(favorites);
  renderFavorites();
  setStatus(`已將「${currentCity.label}」加入收藏`);
};

// ---------------- Search / select ----------------
el("searchBtn").onclick = () => {
  const city = el("citySelect").value;
  selectCity(city);
};

// ---------------- Auto locate (瀏覽器 GPS 定位) ----------------
el("locateBtn").onclick = autoLocate;

// 把反向地理編碼回傳的地區名比對成 CWA 支援的 22 縣市名稱之一
function matchCwaCity(rawName) {
  if (!rawName) return null;
  const normalized = rawName.replace(/台/g, "臺").trim();
  if (CWA_CITIES.includes(normalized)) return normalized;
  for (const c of CWA_CITIES) {
    if (normalized.includes(c) || c.includes(normalized)) return c;
  }
  const key = rawName.toLowerCase().trim();
  return REGION_NAME_MAP[key] || null;
}

function getGpsPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("此瀏覽器不支援定位功能"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 60000,
    });
  });
}

async function autoLocate() {
  setStatus("正在取得 GPS 定位…");
  let pos;
  try {
    pos = await getGpsPosition();
  } catch (e) {
    let reason = "GPS 定位失敗";
    if (e.code === 1) reason = "已拒絕定位權限";
    else if (e.code === 2) reason = "目前無法取得 GPS 定位資訊";
    else if (e.code === 3) reason = "GPS 定位逾時";
    setStatus(`${reason}，改用 IP 定位…`);
    await autoLocateByIp();
    return;
  }

  setStatus("定位成功，正在比對縣市…");
  try {
    const { latitude, longitude } = pos.coords;
    const url = `${GEOCODE_URL}?format=jsonv2&lat=${latitude}&lon=${longitude}` +
      `&accept-language=zh-TW&zoom=10`;
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if ((data.address && data.address.country_code) && data.address.country_code !== "tw") {
      setStatus("目前定位不在台灣，中央氣象署資料僅涵蓋台灣地區，請手動選擇縣市");
      return;
    }
    const addr = data.address || {};
    const raw = addr.county || addr.city || addr.state || addr.town || "";
    const matched = matchCwaCity(raw);
    if (!matched) {
      setStatus(`無法自動比對「${raw || "未知地區"}」，請手動於下拉選單選擇縣市`);
      return;
    }
    el("citySelect").value = matched;
    selectCity(matched);
  } catch (e) {
    setStatus(`定位比對失敗：${e.message}，改用 IP 定位…`);
    await autoLocateByIp();
  }
}

// GPS 不可用時的備援：用 IP 位置粗略比對縣市（準確度較低，但至少桌機沒有 GPS 時也能用）
async function autoLocateByIp() {
  try {
    const resp = await fetch(IP_LOCATE_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (!data.success) throw new Error(data.message || "定位失敗");
    if (data.country_code !== "TW") {
      setStatus("目前 IP 定位不在台灣，中央氣象署資料僅涵蓋台灣地區，請手動選擇縣市");
      return;
    }
    const key = (data.region || "").toLowerCase().trim();
    const matched = REGION_NAME_MAP[key] || matchCwaCity(data.region);
    if (!matched) {
      setStatus(`無法自動比對「${data.region || data.city}」，請手動於下拉選單選擇縣市`);
      return;
    }
    el("citySelect").value = matched;
    selectCity(matched);
  } catch (e) {
    setStatus(`自動定位失敗：${e.message}，請手動於下拉選單選擇縣市`);
  }
}

// ---------------- Fetch & render weather ----------------
// 資料由後台每 5 分鐘輪詢並快取，這裡只透過 IPC 讀快取，不直接打 CWA API。
async function fetchCityWeather(label) {
  const location = await window.weatherAPI.getCity(label);
  if (!location) {
    throw new Error("後台尚無此縣市的快取資料，稍候會自動更新，或按重新整理再試一次");
  }
  return location;
}

// 每個縣市最後一次成功取得的天氣資料。除了放記憶體，也順便存一份到
// localStorage：PWA 被滑掉關掉、重開後整個網頁會重新載入、記憶體會被清空，
// 但 localStorage 還在，開啟時可以先讀出來墊底，避免每次重開都要空等伺服器。
const CITY_WEATHER_CACHE_KEY = "weatherpro_city_weather_cache";
function loadCityWeatherCache() {
  try { return JSON.parse(localStorage.getItem(CITY_WEATHER_CACHE_KEY)) || {}; }
  catch { return {}; }
}
function saveCityWeatherCache() {
  try { localStorage.setItem(CITY_WEATHER_CACHE_KEY, JSON.stringify(cityWeatherCache)); }
  catch { /* 存不進去（例如容量爆了）就算了，不影響其他功能 */ }
}
const cityWeatherCache = loadCityWeatherCache();

async function selectCity(label) {
  if (!(await refreshApiKeyStatus())) {
    setStatus("尚未設定 CWA 授權碼，請聯絡後台管理員設定");
    return;
  }

  currentCity = { label };
  el("cityName").textContent = label;
  renderFavorites();

  const cached = cityWeatherCache[label];
  if (cached) {
    // 有舊資料：先直接顯示，不擋畫面，背景再悄悄刷新
    renderWeather(cached);
    setStatus("資料更新中…");
  } else {
    // 第一次查這個縣市，還沒有任何資料可以先顯示，只好等
    setStatus("載入天氣資料中…");
  }

  try {
    const location = await fetchCityWeather(label);
    // 使用者可能在資料回來前已經切換到別的縣市，這裡要避免覆蓋錯畫面
    cityWeatherCache[label] = location;
    saveCityWeatherCache();
    if (currentCity && currentCity.label === label) {
      renderWeather(location);
      setStatus("更新完成");
    }
  } catch (e) {
    if (currentCity && currentCity.label === label) {
      // 有舊資料可以顯示的話，刷新失敗就默默保留舊畫面就好，不用跳錯誤嚇使用者
      setStatus(cached ? "更新完成（顯示上次資料）" : `取得天氣資料失敗：${e.message}`);
    }
  }

  loadSunTimes(label);
  loadMoonTimes(label);
  loadWindObservation(label);
  loadMoonPhaseImage();
}

// ---------------- 日出／日落 ----------------
// 同一批資料涵蓋全臺所有縣市，同一次網頁工作階段內快取起來，
// 切換城市只要重新查表就好，不用每次都重打 API。
let sunTimesCache = null;
async function loadSunTimes(label) {
  const valueEl = el("sunTimesValue");
  if (!valueEl) return;
  try {
    if (!sunTimesCache) {
      const result = await window.weatherAPI.getSunTimes();
      if (!result || !result.ok) return; // 保持「暫無資料」，不用特別報錯打擾使用者
      sunTimesCache = result.counties || {};
    }
    const times = sunTimesCache[label];
    if (!times || !times.SunRiseTime || !times.SunSetTime) return;
    valueEl.textContent = `${times.SunRiseTime} 升起　${times.SunSetTime} 落下`;
    valueEl.classList.remove("current-stat-empty");
  } catch (e) {
    /* 拿不到就維持「暫無資料」，不影響其他功能 */
  }
}

// ---------------- 月出／月落 ----------------
// 有些日子月亮不會升起或落下（極少數情形），對應欄位是空字串，顯示成「--」。
let moonTimesCache = null;
async function loadMoonTimes(label) {
  const valueEl = el("moonTimesValue");
  if (!valueEl) return;
  try {
    if (!moonTimesCache) {
      const result = await window.weatherAPI.getMoonTimes();
      if (!result || !result.ok) return;
      moonTimesCache = result.counties || {};
    }
    const times = moonTimesCache[label];
    if (!times) return;
    const rise = times.MoonRiseTime || "--";
    const set = times.MoonSetTime || "--";
    valueEl.textContent = `${rise} 升起　${set} 落下`;
    valueEl.classList.remove("current-stat-empty");
  } catch (e) {
    /* 拿不到就維持「暫無資料」，不影響其他功能 */
  }
}

// ---------------- 即時風速（蒲氏風級）----------------
// 跟日出／月出資料同樣邏輯：整批全臺縣市資料一次撈回來，快取在同一次網頁
// 工作階段內，切換城市只要重新查表，不用每次都重打 API。
let windObsCache = null;
async function loadWindObservation(label) {
  const valueEl = el("statWind");
  if (!valueEl) return;
  try {
    if (!windObsCache) {
      const result = await window.weatherAPI.getWindObservation();
      if (!result || !result.ok) return; // 拿不到就維持「暫無資料」，不影響其他功能
      windObsCache = result.counties || {};
    }
    const wind = windObsCache[label];
    if (!wind || wind.beaufortLevel === null || wind.beaufortLevel === undefined) return;
    valueEl.textContent = `${wind.beaufortLevel} 級（${wind.beaufortDesc}）`;
    valueEl.title = `${wind.stationName} 測站　風速 ${wind.windSpeed} m/s`;
    valueEl.classList.remove("current-stat-empty");
  } catch (e) {
    /* 拿不到就維持「暫無資料」，不影響其他功能 */
  }
}

// ---------------- 目前月相圖（NASA SVS Dial-A-Moon，已去背）----------------
// 跟縣市無關，全站共用同一張圖，只要載入過一次就不用每次切換城市重抓。
let moonPhaseLoaded = false;
function loadMoonPhaseImage() {
  if (moonPhaseLoaded) return;
  const img = el("moonPhaseImg");
  const fallback = el("moonPhaseFallbackIcon");
  if (!img) return;
  img.addEventListener("load", () => {
    img.classList.remove("hidden");
    if (fallback) fallback.classList.add("hidden");
  });
  img.addEventListener("error", () => {
    /* 抓失敗就維持原本的 🌙 emoji，不影響其他功能 */
  });
  img.src = "/api/weather/astro?type=moonphase";
  moonPhaseLoaded = true;
}

function getElement(weatherElements, name) {
  return (weatherElements || []).find((w) => w.elementName === name);
}

function renderWeather(location) {
  const elements = location.weatherElement || [];
  const wx = getElement(elements, "Wx");
  const pop = getElement(elements, "PoP");
  const minT = getElement(elements, "MinT");
  const maxT = getElement(elements, "MaxT");
  const ci = getElement(elements, "CI");

  const periodCount = wx && wx.time ? wx.time.length : 0;
  if (periodCount === 0) {
    setStatus("此縣市目前無預報資料");
    return;
  }

  // ---- 目前（最近一期）預報 ----
  const wxNow = wx.time[0].parameter.parameterName;
  const popNow = pop ? pop.time[0].parameter.parameterName : "--";
  const minNow = minT ? minT.time[0].parameter.parameterName : "--";
  const maxNow = maxT ? maxT.time[0].parameter.parameterName : "--";
  const ciNow = ci ? ci.time[0].parameter.parameterName : "--";

  el("currentIcon").innerHTML = iconForWx(wxNow);
  el("currentTemp").textContent = `${minNow}–${maxNow}°C`;
  el("currentDesc").textContent = wxNow;
  el("currentDetail").textContent =
    `舒適度 ${ciNow}\n降雨機率 ${popNow}%\n資料來源：中央氣象署`;
  el("statPop").textContent = `${popNow}%`;

  el("currentViewForecastBtn").classList.remove("hidden");

  applyWeatherBackground(wxNow, wx.time[0].startTime);

  const now = new Date();
  // 「最後更新」文字已依需求移除，不再更新這個欄位

  renderForecast(wx, pop, minT, maxT);
  renderChart(wx, minT, maxT);
}

function formatPeriodLabel(startTimeStr) {
  // startTimeStr 格式如 "2026-08-21 18:00:00"
  const d = new Date(startTimeStr.replace(" ", "T"));
  const hour = d.getHours();
  const dayNight = hour < 12 ? "白天" : hour < 18 ? "傍晚" : "晚上";
  return `${d.getMonth() + 1}/${d.getDate()} ${dayNight}`;
}

function renderForecast(wx, pop, minT, maxT) {
  const row = el("forecastRow");
  row.innerHTML = "";

  const periods = wx.time.length;
  for (let i = 0; i < periods; i++) {
    const wxText = wx.time[i].parameter.parameterName;
    const popText = pop ? pop.time[i].parameter.parameterName : "--";
    const minText = minT ? minT.time[i].parameter.parameterName : "--";
    const maxText = maxT ? maxT.time[i].parameter.parameterName : "--";
    const label = formatPeriodLabel(wx.time[i].startTime);

    const card = document.createElement("div");
    card.className = "forecast-card";
    card.innerHTML = `
      <div class="fdate">${label}</div>
      <div class="ficon">${iconForWx(wxText)}</div>
      <div class="fdesc">${wxText}</div>
      <div class="ftemp">${maxText}° / ${minText}°</div>
      <div class="fpop">降雨機率 ${popText}%</div>
    `;
    row.appendChild(card);
  }
}

function renderChart(wx, minT, maxT) {
  const canvas = el("tempChart");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const padL = 46, padR = 20, padT = 24, padB = 40;
  ctx.clearRect(0, 0, W, H);

  const periods = wx.time.length;
  if (periods === 0 || !minT || !maxT) return;

  const labels = wx.time.map((t) => formatPeriodLabel(t.startTime));
  const tmax = maxT.time.map((t) => parseFloat(t.parameter.parameterName));
  const tmin = minT.time.map((t) => parseFloat(t.parameter.parameterName));

  const allVals = [...tmax, ...tmin];
  const maxV = Math.max(...allVals) + 2;
  const minV = Math.min(...allVals) - 2;
  const xStep = (W - padL - padR) / (periods - 1 || 1);
  const yScale = (H - padT - padB) / (maxV - minV || 1);

  const toX = (i) => padL + i * xStep;
  const toY = (v) => H - padB - (v - minV) * yScale;

  ctx.strokeStyle = "rgba(30,42,60,0.12)";
  ctx.fillStyle = "#6b7684";
  ctx.font = "11px sans-serif";
  const gridLines = 5;
  for (let g = 0; g <= gridLines; g++) {
    const v = minV + ((maxV - minV) / gridLines) * g;
    const y = toY(v);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(v)}°`, 6, y + 4);
  }

  labels.forEach((label, i) => {
    ctx.fillText(label, toX(i) - 20, H - 16);
  });

  function drawLine(values, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = toX(i), y = toY(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    values.forEach((v, i) => {
      const x = toX(i), y = toY(v);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  drawLine(tmax, "#e8703c");
  drawLine(tmin, "#3378d6");

  ctx.fillStyle = "#e8703c";
  ctx.fillRect(padL, 6, 10, 10);
  ctx.fillStyle = "#222b38";
  ctx.fillText("最高溫", padL + 16, 15);
  ctx.fillStyle = "#3378d6";
  ctx.fillRect(padL + 70, 6, 10, 10);
  ctx.fillStyle = "#222b38";
  ctx.fillText("最低溫", padL + 86, 15);
}

// ---------------- Multi-city compare ----------------
const COMPARE_COLORS = ["#e8703c", "#3378d6", "#2e9e52", "#c9a02a", "#9457d1", "#d64a82", "#2aa6a6", "#c07a2a"];

async function renderCompareView(labels) {
  const grid = el("compareGrid");
  const chartCanvas = el("compareChart");
  const emptyMsg = el("compareEmpty");

  if (!(await refreshApiKeyStatus())) {
    emptyMsg.textContent = "尚未設定 CWA 授權碼，請聯絡後台管理員設定";
    emptyMsg.classList.remove("hidden");
    grid.innerHTML = "";
    chartCanvas.classList.add("hidden");
    return;
  }

  if (labels.length < 2) {
    emptyMsg.textContent = "請在左側收藏城市清單勾選 2 個以上的城市，再點擊「比較所選城市」。";
    emptyMsg.classList.remove("hidden");
    grid.innerHTML = "";
    chartCanvas.classList.add("hidden");
    return;
  }

  emptyMsg.classList.add("hidden");
  grid.innerHTML = "";
  chartCanvas.classList.add("hidden");
  setStatus("載入多城市比較資料中…");

  const results = await Promise.all(
    labels.map(async (label) => {
      try {
        const location = await fetchCityWeather(label);
        return { label, location };
      } catch (e) {
        return { label, error: e.message };
      }
    })
  );

  grid.innerHTML = "";
  results.forEach(({ label, location, error }) => {
    const card = document.createElement("div");
    card.className = "compare-card";

    if (error) {
      card.innerHTML = `<div class="ccity">${label}</div><div class="cerr">取得失敗：${error}</div>`;
      grid.appendChild(card);
      return;
    }

    const elements = location.weatherElement || [];
    const wx = getElement(elements, "Wx");
    const pop = getElement(elements, "PoP");
    const minT = getElement(elements, "MinT");
    const maxT = getElement(elements, "MaxT");

    const wxNow = wx && wx.time && wx.time[0] ? wx.time[0].parameter.parameterName : "--";
    const popNow = pop && pop.time && pop.time[0] ? pop.time[0].parameter.parameterName : "--";
    const minNow = minT && minT.time && minT.time[0] ? minT.time[0].parameter.parameterName : "--";
    const maxNow = maxT && maxT.time && maxT.time[0] ? maxT.time[0].parameter.parameterName : "--";

    card.innerHTML = `
      <div class="ccity">${label}</div>
      <div class="cicon">${iconForWx(wxNow)}</div>
      <div class="cdesc">${wxNow}</div>
      <div class="ctemp">${minNow}–${maxNow}°C</div>
      <div class="cpop">降雨機率 ${popNow}%</div>
    `;
    grid.appendChild(card);
  });

  const validResults = results.filter((r) => !r.error && r.location);
  if (validResults.length >= 2) {
    renderCompareChart(validResults);
    chartCanvas.classList.remove("hidden");
  }

  setStatus("比較資料更新完成");
}

function renderCompareChart(results) {
  const canvas = el("compareChart");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const padL = 46, padR = 20, padT = 30, padB = 40;
  ctx.clearRect(0, 0, W, H);

  const series = results.map(({ label, location }) => {
    const elements = location.weatherElement || [];
    const wx = getElement(elements, "Wx");
    const maxT = getElement(elements, "MaxT");
    const periods = wx && wx.time ? wx.time.length : 0;
    const labels = wx ? wx.time.map((t) => formatPeriodLabel(t.startTime)) : [];
    const values = maxT ? maxT.time.map((t) => parseFloat(t.parameter.parameterName)) : [];
    return { label, periods, labels, values };
  }).filter((s) => s.periods > 0 && s.values.length > 0);

  if (series.length === 0) return;

  const periods = Math.min(...series.map((s) => s.periods));
  const labels = series[0].labels.slice(0, periods);
  const allVals = series.flatMap((s) => s.values.slice(0, periods));
  const maxV = Math.max(...allVals) + 2;
  const minV = Math.min(...allVals) - 2;
  const xStep = (W - padL - padR) / (periods - 1 || 1);
  const yScale = (H - padT - padB) / (maxV - minV || 1);

  const toX = (i) => padL + i * xStep;
  const toY = (v) => H - padB - (v - minV) * yScale;

  ctx.strokeStyle = "rgba(30,42,60,0.12)";
  ctx.fillStyle = "#6b7684";
  ctx.font = "11px sans-serif";
  const gridLines = 5;
  for (let g = 0; g <= gridLines; g++) {
    const v = minV + ((maxV - minV) / gridLines) * g;
    const y = toY(v);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(v)}°`, 6, y + 4);
  }

  labels.forEach((label, i) => {
    ctx.fillText(label, toX(i) - 20, H - 16);
  });

  series.forEach((s, idx) => {
    const color = COMPARE_COLORS[idx % COMPARE_COLORS.length];
    const values = s.values.slice(0, periods);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = toX(i), y = toY(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    values.forEach((v, i) => {
      const x = toX(i), y = toY(v);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  // 圖例（各城市最高溫）
  let legendX = padL;
  const legendY = 8;
  series.forEach((s, idx) => {
    const color = COMPARE_COLORS[idx % COMPARE_COLORS.length];
    ctx.fillStyle = color;
    ctx.fillRect(legendX, legendY, 10, 10);
    ctx.fillStyle = "#222b38";
    ctx.font = "11px sans-serif";
    ctx.fillText(s.label, legendX + 14, legendY + 9);
    legendX += 14 + ctx.measureText(s.label).width + 16;
  });
}

// ---------------- Map selection ----------------
function selectMapCity(label) {
  document.querySelectorAll(".county").forEach((p) => {
    p.classList.toggle("selected", p.dataset.city === label);
  });
  el("citySelect").value = label;
  el("mapHint").textContent = `${label}　查詢中…`;

  selectCity(label).then(() => {
    if (!currentCity || currentCity.label !== label) return;
    el("mapHint").textContent = `已選擇：${label}（天氣摘要已更新至最上方）`;
  });
}

document.querySelectorAll(".county").forEach((path) => {
  path.addEventListener("click", () => selectMapCity(path.dataset.city));
});

function goToForecastTab() {
  document.querySelector('.tab-btn[data-tab="forecast"]').click();
}
el("currentViewForecastBtn").onclick = goToForecastTab;

// ---------------- Tabs ----------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    const panelMap = {
      forecast: "forecastPanel",
      chart: "chartPanel",
      compare: "comparePanel",
      map: "mapPanel",
      alerts: "alertsPanel",
      typhoon: "typhoonPanel",
    };
    const target = panelMap[btn.dataset.tab] || "forecastPanel";
    el(target).classList.add("active");
    if (btn.dataset.tab === "compare") {
      renderCompareView(Array.from(selectedCompare));
    }
    if (btn.dataset.tab === "alerts") {
      loadAlerts();
      loadTyphoonProbability();
    }
    if (btn.dataset.tab === "typhoon") {
      loadAlerts();
      loadTyphoonProbability();
    }
    const bottomMap = { forecast: "home", typhoon: "typhoon", alerts: "typhoon" };
    setBottomNavActive(bottomMap[btn.dataset.tab] || "tools");
  });
});

// ---------------- 警特報（颱風警報／大雨(豪雨)特報 + 颱風暴風圈侵襲機率） ----------------
const ALERT_SOURCE_LABEL = { typhoon: "颱風警報", rain: "大雨(豪雨)特報" };
const ALERT_SEVERITY_FALLBACK_COLOR = {
  Extreme: "#c0392b",
  Severe: "#e67e22",
  Moderate: "#f1c40f",
  Minor: "#95a5a6",
};
// 大雨(豪雨)特報四級顏色：黃＝大雨、橙＝豪雨、紅＝大豪雨、紫＝超大豪雨
// （正常情況後端會直接帶 rec.color，這裡只當保底）
const RAIN_LEVEL_FALLBACK_COLOR = {
  大雨: "rgb(255,255,0)",
  豪雨: "rgb(255,128,0)",
  大豪雨: "rgb(255,0,0)",
  超大豪雨: "rgb(155,48,255)",
};

function formatAlertTime(isoStr) {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  return d.toLocaleString("zh-TW", { hour12: false });
}

// 黃色底比較亮，用深色字；橙/紅/紫底用白字，確保色塊文字看得清楚
const RAIN_LEVEL_TEXT_COLOR = {
  大雨: "#5c4a00",
  豪雨: "#ffffff",
  大豪雨: "#ffffff",
  超大豪雨: "#ffffff",
};
function rainChipStyle(color, level) {
  const textColor = RAIN_LEVEL_TEXT_COLOR[level] || "#ffffff";
  return `background:${color};color:${textColor};`;
}

// ---------------- 大雨(豪雨)特報縣市分布地圖 ----------------
// 山區/平地/恆春半島/綠島/蘭嶼的邊界，改用內政部官方鄉鎮市區界線圖資產生的
// 真實地圖（見 index.html 裡的 <template id="twZoneMapTemplate">，由
// scripts/build-zone-map.js 產生），不再用手畫的假分界線疊色。

const RAIN_LEVEL_ORDER = ["超大豪雨", "大豪雨", "豪雨", "大雨"]; // 由重到輕
function rainLevelRank(level) {
  const i = RAIN_LEVEL_ORDER.indexOf(level);
  return i === -1 ? RAIN_LEVEL_ORDER.length : i;
}
// 分區顯示順序，跟中央氣象署官網彈出視窗一致：平地 → 恆春半島 → 山區 → 綠島 → 蘭嶼
const ZONE_ORDER = ["平地", "恆春半島", "山區", "綠島", "蘭嶼"];
function zoneRank(zone) {
  const i = ZONE_ORDER.indexOf(zone);
  return i === -1 ? ZONE_ORDER.length : i;
}

let alertMapBuilt = false;
let latestMapAlerts = [];
let alertMapHasData = false; // 大雨(豪雨)特報縣市分布圖有沒有資料可以顯示；
                              // 有資料時也不自動打開，要點警特報卡片的「詳細資訊」按鈕才顯示。

// 「警特報」分頁的地圖，改成 clone index.html 裡 <template id="twZoneMapTemplate">
// 內建好的分區地圖（見 scripts/build-zone-map.js），每個縣市依「山區/平地/
// 恆春半島/綠島/蘭嶼」各自是獨立的 <path>（class="alert-zone"，
// data-county + data-zone），縣市外框另外疊一層乾淨的 .alert-county-outline，
// 不用再像以前那樣自己算 clipPath、疊假的山區色塊矩形。
// 主地圖（twZoneMapTemplate）用同一把尺畫整個台灣＋離島，澎湖/金門/連江
// 面積比本島小太多，即使 mercatorTw 把它們挪到本島旁邊，畫出來還是只有
// 幾個小點。這三個 inset模板（scripts/build-insets.js 產生）是各自獨立、
// 各自滿版縮放的小地圖，跟中央氣象署官網一樣把外離島放大成卡片。裡面的
// <path class="alert-zone"> 用跟主地圖一樣的 data-county/data-zone 格式，
// 所以上色、hover、彈出視窗完全共用同一套邏輯，不用另外寫。
const ALERT_MAP_TEMPLATES = [
  { templateId: "twZoneMapTemplate", holderId: "alertMapHolder" },
  { templateId: "twInsetPenghuTemplate", holderId: "alertInsetPenghuHolder" },
  { templateId: "twInsetKinmenTemplate", holderId: "alertInsetKinmenHolder" },
  { templateId: "twInsetLienchiangTemplate", holderId: "alertInsetLienchiangHolder" },
];
const ALERT_ZONE_SELECTOR = "#alertMapHolder .alert-zone, #alertMapInsets .alert-zone";

// 收起大雨特報地圖的彈出小視窗，並清掉目前的選取/hover 樣式。
function hideAlertMapTooltip() {
  el("alertMapTooltip").classList.add("hidden");
  document.querySelectorAll(ALERT_ZONE_SELECTOR).forEach((p) => p.classList.remove("selected"));
  document
    .querySelectorAll("#alertMapHolder .alert-county-outline")
    .forEach((o) => o.classList.remove("selected", "hover"));
  document
    .querySelectorAll("#alertMapWrap .alert-inset-outline")
    .forEach((o) => o.classList.remove("selected", "hover"));
}

function buildAlertMap() {
  if (alertMapBuilt) return;

  for (const { templateId, holderId } of ALERT_MAP_TEMPLATES) {
    const template = document.getElementById(templateId);
    const holder = el(holderId);
    if (!template || !holder) continue;
    const clone = template.content.firstElementChild.cloneNode(true);

    clone.querySelectorAll(".alert-zone").forEach((p) => {
      // 滑鼠移入（碰到）該分區色塊就顯示整個縣市的小視窗（不必等點擊）；
      // 同時保留 click，讓觸控裝置點一下也能顯示。同一個縣市可能對應好幾塊
      // alert-zone（例如高雄市山區 + 高雄市平地），hover 任何一塊都算碰到
      // 這個縣市。小視窗直接跟著滑鼠位置顯示（見 positionTooltipNearCursor），
      // 不用再去抓地圖上的縣市外框位置——離島卡片（放大過的澎湖/金門/連江）
      // 沒有自己的外框圖層，之前用主地圖上那個縣市（其實是離本島很遠的小點）
      // 位置去定位，卡片會跳到跟滑鼠completely無關的地方。
      p.addEventListener("mouseenter", (evt) => {
        showCountyTooltip(p.dataset.county, evt);
        syncBoundaryState(p.dataset.county, "hover", true);
        toggleInsetOutline(p.dataset.county, "hover", true);
      });
      p.addEventListener("mousemove", (evt) => positionTooltipNearCursor(evt));
      p.addEventListener("mouseleave", () => {
        syncBoundaryState(p.dataset.county, "hover", false);
        toggleInsetOutline(p.dataset.county, "hover", false);
      });
      p.addEventListener("click", (evt) => showCountyTooltip(p.dataset.county, evt));
    });

    holder.appendChild(clone);
  }

  // 滑鼠離開整個地圖區塊，或是移到地圖上「非島嶼」的空白區域（海面、
  // 主地圖與離島卡片之間的空隙等），都要收起彈出視窗——只要滑鼠當下
  // 不是真的碰在某個 .alert-zone 色塊上，就代表沒有對應到任何縣市。
  const section = el("alertMapSection");
  if (section) {
    section.addEventListener("mouseleave", hideAlertMapTooltip);
    section.addEventListener("mousemove", (evt) => {
      if (!evt.target.closest(".alert-zone")) hideAlertMapTooltip();
    });
  }
  alertMapBuilt = true;
}

// 把真正互動用的 .alert-zone（hover / 選取）狀態，同步畫到蓋在最上面那層
// 純視覺的縣界線（.alert-county-outline）上，這樣滑鼠移過去縣界會變色時，
// 才不會被底下的分區色塊蓋住看不到。
function syncBoundaryState(county, stateClass, on, holderId = "alertMapHolder") {
  const outline = document.querySelector(`#${holderId} .alert-county-outline[data-county="${county}"]`);
  if (outline) outline.classList.toggle(stateClass, on);
}

// 離島卡片（澎湖/金門/連江）沒有本島那層獨立的 .alert-county-outline，改用
// scripts/build-insets.js 事先把同縣市所有鄉鎮色塊做幾何聯集算出來的島嶼輪廓
// （<path class="alert-inset-outline">，只描外緣，不含鄉鎮市區界線），滑鼠碰到
// 時切換 hover/selected class，效果（線寬、顏色）直接比照本島的
// .alert-county-outline，兩邊看起來才會一致，不會像疊 drop-shadow 那樣是模糊的光暈。
// 大雨地圖跟颱風地圖各自 clone 了一份離島卡片（同一個縣市在兩個分頁各有一份
// <path class="alert-inset-outline">），用 wrapId 限定只切換「這個分頁」裡的
// 那一份，滑鼠在大雨分頁碰到，不會連颱風分頁（此刻多半是隱藏的）也一起變色。
function toggleInsetOutline(county, stateClass, on, wrapId = "alertMapWrap") {
  document
    .querySelectorAll(`#${wrapId} .alert-inset-outline[data-county="${county}"]`)
    .forEach((o) => o.classList.toggle(stateClass, on));
}

// 鄉鎮地名（如「花蓮縣秀林鄉」）歸屬到所屬縣市：取 CWA_CITIES 裡吻合的字首
function areaNameToCounty(areaName) {
  let best = null;
  for (const city of CWA_CITIES) {
    if (areaName.startsWith(city) && (!best || city.length > best.length)) best = city;
  }
  return best;
}

// 不拿 CAP 的 areaDesc 去跟地圖 <path> 的 data-full 逐字比對（CWA 原始字串
// 偶爾會夾帶看不出來的雜訊：頭尾空白、不可見字元、括號註記等，逐字比對只要
// 有一點差異就整塊塗不到）。改成拿「縣市 + 山區/平地」這個組合上色：
//   - 山區/平地的分類本來就是離線算好的固定名單（data-zone），跟 CWA 這次
//     傳回來的字串乾不乾淨完全無關，不會被雜訊字元影響。
//   - 縣市歸屬只需要「前綴比對」（areaNameToCounty 用 startsWith），字串
//     尾端多一點雜訊也不影響判斷結果，比逐字完全比對穩定很多。
// 代價：如果同一個縣市、同一個分區裡（例如台東「平地」）不同鄉鎮剛好落在
// 不同等級，會沒辦法呈現這種細節、整個分區只會塗成其中一種顏色。這種情況
// 比較少見，換來「不會有鄉鎮莫名沒上色」，是划算的取捨。
function computeZoneLevels(alerts) {
  const result = {}; // "縣市|分區" -> { level, color }
  const activeRain = (alerts || []).filter((a) => a.source === "rain" && a.isActive);
  for (const alert of activeRain) {
    for (const [zone, areas] of Object.entries(alert.areasByZone || {})) {
      for (const area of areas) {
        const county = areaNameToCounty(area.name);
        if (!county) continue; // 抓不到縣市歸屬就跳過，不亂塗
        const key = `${county}|${zone}`;
        const rank = rainLevelRank(area.level);
        const current = result[key];
        if (!current || rank < rainLevelRank(current.level)) {
          result[key] = {
            level: area.level,
            color: area.color || RAIN_LEVEL_FALLBACK_COLOR[area.level] || "#ffffff",
          };
        }
      }
    }
  }
  return result;
}

const RAIN_LEVEL_ICON_KEY = { 大雨: "rain", 豪雨: "heavyRain", 大豪雨: "extremeRain", 超大豪雨: "extremeRain" };

// 點擊縣市彈出視窗用：分別找出該縣市各分區（平地/恆春半島/山區/綠島/蘭嶼）
// 目前的等級。同一分區底下可能有好幾個鄉鎮、各自等級不一定相同，但畫面上
// 只呈現「一個分區一個答案」，取該分區裡最嚴重的等級當代表（跟地圖上色的
// computeZoneLevels 用同一套邏輯，兩邊才會一致：地圖塗豪雨的橙色，彈出
// 視窗就只會寫「豪雨【平地】」，不會同時列出豪雨又列出大雨。
function getCountyLevelsByZone(county) {
  const levelsByZone = {}; // 分區 -> 最嚴重的等級
  const activeRain = (latestMapAlerts || []).filter((a) => a.source === "rain" && a.isActive);
  for (const alert of activeRain) {
    for (const [zone, areas] of Object.entries(alert.areasByZone || {})) {
      for (const area of areas) {
        if (areaNameToCounty(area.name) !== county) continue;
        const rank = rainLevelRank(area.level);
        const current = levelsByZone[zone];
        if (!current || rank < rainLevelRank(current)) {
          levelsByZone[zone] = area.level;
        }
      }
    }
  }
  return levelsByZone;
}

// 點擊地圖上的縣市，跳出跟中央氣象署官網一樣的小視窗：哪個分區是什麼等級
function showCountyTooltip(county, evt) {
  document
    .querySelectorAll(ALERT_ZONE_SELECTOR)
    .forEach((p) => p.classList.toggle("selected", p.dataset.county === county));
  document
    .querySelectorAll("#alertMapHolder .alert-county-outline")
    .forEach((o) => o.classList.toggle("selected", o.dataset.county === county));
  document
    .querySelectorAll("#alertMapWrap .alert-inset-outline")
    .forEach((o) => o.classList.toggle("selected", o.dataset.county === county));

  const tooltip = el("alertMapTooltip");
  const levelsByZone = getCountyLevelsByZone(county);

  if (!Object.keys(levelsByZone).length) {
    tooltip.innerHTML = `
      <div class="alert-map-tooltip-title">${county}</div>
      <div class="alert-map-tooltip-empty">目前沒有生效中的大雨(豪雨)特報</div>`;
  } else {
    // 每個分區只留最嚴重的那一個等級（見 getCountyLevelsByZone），
    // 排列順序固定比照官網：平地 → 恆春半島 → 山區 → 綠島 → 蘭嶼
    const entries = Object.entries(levelsByZone).map(([zone, level]) => ({ zone, level }));
    entries.sort((a, b) => zoneRank(a.zone) - zoneRank(b.zone));

    const rows = entries.map(
      (e) =>
        `<div class="alert-map-tooltip-row">${iconImg(RAIN_LEVEL_ICON_KEY[e.level] || "rain", e.level)}<span>${e.level}【${e.zone}】</span></div>`
    );
    tooltip.innerHTML = `<div class="alert-map-tooltip-title">${county}</div>${rows.join("")}`;
  }

  tooltip.classList.remove("hidden");
  if (evt) positionTooltipNearCursor(evt);
}

// 小視窗貼著滑鼠顯示：不管是主地圖還是放大過的離島卡片，直接用滑鼠在
// #alertMapWrap 裡的相對座標 + 一點偏移擺放，不用再去算某個縣市外框的
// bbox（離島卡片沒有外框圖層，且外框本來就跟卡片放大後的位置對不上）。
// 顯示完再檢查一次小視窗實際寬高，貼著容器邊界夾住，避免視窗被切一半。
function positionTooltipNearCursor(evt, tooltipId = "alertMapTooltip", wrapId = "alertMapWrap") {
  const tooltip = el(tooltipId);
  if (tooltip.classList.contains("hidden")) return;
  const wrap = el(wrapId);
  const wrapRect = wrap.getBoundingClientRect();
  const OFFSET = 14;

  let left = evt.clientX - wrapRect.left + OFFSET;
  let top = evt.clientY - wrapRect.top + OFFSET;

  const tRect = tooltip.getBoundingClientRect();
  const maxLeft = wrapRect.width - tRect.width - 4;
  const maxTop = wrapRect.height - tRect.height - 4;
  if (maxLeft >= 0) left = Math.min(left, maxLeft);
  if (maxTop >= 0) top = Math.min(top, maxTop);
  left = Math.max(left, 4);
  top = Math.max(top, 4);

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function renderAlertMap(alerts) {
  const section = el("alertMapSection");
  latestMapAlerts = alerts || [];
  const zoneLevels = computeZoneLevels(alerts);
  const hasAny = Object.keys(zoneLevels).length > 0;
  alertMapHasData = hasAny;

  // 不自動打開：一律先收起來，要點警特報卡片上的「詳細資訊」按鈕才顯示，
  // 這裡只負責在有資料時把地圖內容準備好，資料變動時（例如警報解除）
  // 也順便把已經展開的地圖收回去，避免顯示過期內容。
  section.classList.add("hidden");
  if (!hasAny) {
    hideAlertMapTooltip();
    return;
  }

  buildAlertMap();

  // 每個 <path class="alert-zone"> 都是一個真實的鄉鎮市區邊界，帶有
  // data-county（縣市）+ data-zone（山區/平地/恆春半島/綠島/蘭嶼），兩者
  // 都是離線算好的固定資料，跟這次 CAP 傳回來的字串乾不乾淨無關。直接用
  // 「這個鄉鎮屬於哪個縣市、哪個分區」去查 zoneLevels 該塗什麼顏色，
  // 不用管這個鄉鎮自己的名字有沒有辦法跟 CAP 的 areaDesc 逐字對上。
  document.querySelectorAll(ALERT_ZONE_SELECTOR).forEach((path) => {
    const key = `${path.dataset.county}|${path.dataset.zone}`;
    const hit = zoneLevels[key];
    const color = hit ? hit.color : "#ffffff";
    path.style.fill = color;
    // 相鄰鄉鎮各自是獨立的 <path>，就算不畫邊框，瀏覽器反鋸齒還是會在交界處
    // 留下一條看得到的細縫，像是鄉鎮界線。把邊框顏色設成跟填色一樣（而不是
    // none 或留給 CSS 的灰色細線），細縫一律被同色蓋掉，鄉鎮市區之間的界線
    // 不管本島主地圖還是離島小卡（澎湖/金門/連江）、有無警報上色都看不到。
    // 本島的縣市外框是另外一層 .alert-county-outline，不受這裡影響；離島
    // 小卡沒有這層外框，改用 style.css 的 .alert-inset-holder svg 那個
    // drop-shadow 濾鏡描出整座島的外緣輪廓，才不會在白色卡片背景上隱形。
    path.style.stroke = color;
  });

  const legend = el("alertMapLegend");
  const allLevels = Object.values(zoneLevels).map((v) => v.level);
  legend.innerHTML = RAIN_LEVEL_ORDER.slice()
    .reverse()
    .filter((level) => allLevels.includes(level))
    .map(
      (level) => `
      <div class="alert-map-legend-item">
        <span class="alert-map-legend-swatch" style="background:${RAIN_LEVEL_FALLBACK_COLOR[level]}"></span>
        <span>${level}</span>
      </div>`
    )
    .join("");
}

// ---------------- 颱風警報範圍圖（獨立「颱風」分頁，跟大雨(豪雨)地圖分開） ----------------
// 陸上颱風警報＝整個縣市塗紅（跟大雨地圖同邏輯，不分山區/平地，直接不管
// data-zone，同一個縣市所有 .alert-zone 色塊一起塗）；
// 海上颱風警報＝依 launcher/typhoon-sea-area-mapping.js 對照到的鄰近沿海
// 縣市塗螢光黃。兩者同時命中同一個縣市時，陸上警報（紅）優先顯示。
// 地圖架構跟大雨(豪雨)特報地圖完全比照：本島 + 澎湖/金門/連江三張放大離島
// 卡片、滑鼠碰到/點擊縣市會跳出小視窗、縣市外框 hover 會變粗，全部共用
// buildAlertMap() 那一套模板跟輔助函式，只是 holder id、彈出視窗內容跟塗色
// 邏輯換成颱風警報自己的。
const TYPHOON_LAND_COLOR = "#e60000"; // 陸上颱風警報：紅
const TYPHOON_SEA_COLOR = "#faff00"; // 海上颱風警報：螢光黃

const TYPHOON_MAP_TEMPLATES = [
  { templateId: "twZoneMapTemplate", holderId: "typhoonMapHolder" },
  { templateId: "twInsetPenghuTemplate", holderId: "typhoonInsetPenghuHolder" },
  { templateId: "twInsetKinmenTemplate", holderId: "typhoonInsetKinmenHolder" },
  { templateId: "twInsetLienchiangTemplate", holderId: "typhoonInsetLienchiangHolder" },
];
const TYPHOON_ZONE_SELECTOR = "#typhoonMapHolder .alert-zone, #typhoonMapInsets .alert-zone";

let typhoonMapBuilt = false;
let latestTyphoonLandCounties = new Set();
let latestTyphoonSeaCounties = new Set();
// 縣市 -> 實際發布海上颱風警報的海域名稱（Set）。縣市本身不是海上颱風警報
// 的對象，這份表只是拿來讓小視窗講清楚「是哪個海域」，不要講得像是這個
// 縣市自己有海上颱風警報。
let latestTyphoonSeaAreasByCounty = new Map();

// 收起颱風地圖的彈出小視窗，並清掉目前的選取/hover 樣式（跟 hideAlertMapTooltip
// 是同一套邏輯，只是換成颱風分頁自己的 holder/tooltip）。
function hideTyphoonMapTooltip() {
  el("typhoonMapTooltip").classList.add("hidden");
  document.querySelectorAll(TYPHOON_ZONE_SELECTOR).forEach((p) => p.classList.remove("selected"));
  document
    .querySelectorAll("#typhoonMapHolder .alert-county-outline")
    .forEach((o) => o.classList.remove("selected", "hover"));
  document
    .querySelectorAll("#typhoonMapWrap .alert-inset-outline")
    .forEach((o) => o.classList.remove("selected", "hover"));
}

function buildTyphoonMap() {
  if (typhoonMapBuilt) return;

  for (const { templateId, holderId } of TYPHOON_MAP_TEMPLATES) {
    const template = document.getElementById(templateId);
    const holder = el(holderId);
    if (!template || !holder) continue;
    const clone = template.content.firstElementChild.cloneNode(true);

    // 陸地色塊只在「這個縣市有陸上颱風警報」時才要有反應；如果這個縣市只有
    // 海上颱風警報（陸地本身是白色、沒上色），碰到陸地色塊要完全沒反應，
    // 海上警報只透過下面那段沿海黃線（.alert-sea-outline）自己的滑鼠事件跳出。
    clone.querySelectorAll(".alert-zone").forEach((p) => {
      p.addEventListener("mouseenter", (evt) => {
        if (!latestTyphoonLandCounties.has(p.dataset.county)) return;
        showTyphoonCountyTooltip(p.dataset.county, evt);
        syncBoundaryState(p.dataset.county, "hover", true, "typhoonMapHolder");
        toggleInsetOutline(p.dataset.county, "hover", true, "typhoonMapWrap");
      });
      p.addEventListener("mousemove", (evt) => {
        if (!latestTyphoonLandCounties.has(p.dataset.county)) return;
        positionTooltipNearCursor(evt, "typhoonMapTooltip", "typhoonMapWrap");
      });
      p.addEventListener("mouseleave", () => {
        if (!latestTyphoonLandCounties.has(p.dataset.county)) return;
        syncBoundaryState(p.dataset.county, "hover", false, "typhoonMapHolder");
        toggleInsetOutline(p.dataset.county, "hover", false, "typhoonMapWrap");
      });
      p.addEventListener("click", (evt) => {
        if (!latestTyphoonLandCounties.has(p.dataset.county)) return;
        showTyphoonCountyTooltip(p.dataset.county, evt);
      });
    });

    // 海上颱風警報是畫在沿海那段邊界線上的黃線（不是縣市發布的，是海域發布
    // 的，只是拿鄰近縣市當視覺參考），所以滑鼠/手指碰到「線本身」也要能跳出
    // 小視窗，不能只靠碰到底下的陸地 .alert-zone 才有反應。跟 .alert-zone
    // 共用同一套 showTyphoonCountyTooltip，但刻意不共用 syncBoundaryState／
    // toggleInsetOutline（那是給陸上警報縣市外框用的）——碰到海上警報線，
    // 只有線自己要反應，縣市本身（含外框/輪廓）不應該跟著亮起來。
    clone.querySelectorAll(".alert-sea-outline, .alert-sea-outline-casing").forEach((p) => {
      p.addEventListener("mouseenter", (evt) => {
        showTyphoonCountyTooltip(p.dataset.county, evt);
        // 碰到海上警報線只讓「線」自己反應（see below 整條線一起變深），
        // 不要連底下這個縣市的外框／輪廓也一起亮起來，兩者是分開的視覺
        // 元素：縣市外框亮起來是給「陸上颱風警報」用的，海上警報碰到的
        // 只是沿海那條線，不應該連帶讓縣市本身看起來也被反白/加粗。
        document
          .querySelectorAll("#typhoonMapHolder .alert-sea-outline.active, #typhoonMapHolder .alert-sea-outline-casing.active")
          .forEach((line) => line.classList.add("line-hover"));
      });
      p.addEventListener("mousemove", (evt) => positionTooltipNearCursor(evt, "typhoonMapTooltip", "typhoonMapWrap"));
      p.addEventListener("mouseleave", () => {
        document
          .querySelectorAll("#typhoonMapHolder .alert-sea-outline.line-hover, #typhoonMapHolder .alert-sea-outline-casing.line-hover")
          .forEach((line) => line.classList.remove("line-hover"));
      });
      p.addEventListener("click", (evt) => showTyphoonCountyTooltip(p.dataset.county, evt));
    });

    holder.appendChild(clone);
  }

  const section = el("typhoonMapSection");
  if (section) {
    section.addEventListener("mouseleave", hideTyphoonMapTooltip);
    section.addEventListener("mousemove", (evt) => {
      // 碰到「有陸上警報的陸地色塊」或碰到沿海黃線，才算「碰到有效目標」；
      // 碰到沒有陸上警報的陸地色塊（純白，只是底圖）不算，要收起小視窗，
      // 不然滑鼠從黃線滑進旁邊的白色陸地時，小視窗會卡住不消失。
      const zone = evt.target.closest(".alert-zone");
      const onActiveLand = zone && latestTyphoonLandCounties.has(zone.dataset.county);
      const onSeaLine = evt.target.closest(".alert-sea-outline, .alert-sea-outline-casing");
      if (!onActiveLand && !onSeaLine) hideTyphoonMapTooltip();
    });
  }
  typhoonMapBuilt = true;
}

// 點擊/碰到地圖上的縣市，跳出小視窗顯示這個縣市目前是陸上颱風警報／海上
// 颱風警報／沒有警報，跟大雨地圖的 showCountyTooltip 是同一套做法。
function showTyphoonCountyTooltip(county, evt) {
  document
    .querySelectorAll(TYPHOON_ZONE_SELECTOR)
    .forEach((p) => p.classList.toggle("selected", p.dataset.county === county));
  document
    .querySelectorAll("#typhoonMapHolder .alert-county-outline")
    .forEach((o) => o.classList.toggle("selected", o.dataset.county === county));
  document
    .querySelectorAll("#typhoonMapWrap .alert-inset-outline")
    .forEach((o) => o.classList.toggle("selected", o.dataset.county === county));

  const tooltip = el("typhoonMapTooltip");
  const isLand = latestTyphoonLandCounties.has(county);
  const isSea = latestTyphoonSeaCounties.has(county);

  if (!isLand && !isSea) {
    tooltip.innerHTML = `
      <div class="alert-map-tooltip-title">${county}</div>
      <div class="alert-map-tooltip-empty">目前沒有生效中的颱風警報</div>`;
  } else if (isLand) {
    // 陸上颱風警報是發布給縣市的，維持顯示縣市名稱當標題；如果同時也碰到
    // 沿海海上警報的線，一併列出海域名稱。
    const rows = [`<div class="alert-map-tooltip-row"><span>陸上颱風警報</span></div>`];
    if (isSea) {
      const areaNames = Array.from(latestTyphoonSeaAreasByCounty.get(county) || []);
      const areaText = areaNames.length ? areaNames.join("、") : "鄰近海域";
      rows.push(`<div class="alert-map-tooltip-row"><span>海上颱風警報：${areaText}</span></div>`);
    }
    tooltip.innerHTML = `<div class="alert-map-tooltip-title">${county}</div>${rows.join("")}`;
  } else {
    // 純海上颱風警報：這條線是畫在鄰近海岸線上的視覺參考，警報本身是發布
    // 給海域的，不是這個縣市，所以標題不寫縣市名稱，直接講海域名稱。
    const areaNames = Array.from(latestTyphoonSeaAreasByCounty.get(county) || []);
    const areaText = areaNames.length ? areaNames.join("、") : "鄰近海域";
    tooltip.innerHTML = `
      <div class="alert-map-tooltip-title">海上颱風警報</div>
      <div class="alert-map-tooltip-row"><span>${areaText}</span></div>
      <div class="alert-map-tooltip-note">海上颱風警報依海域發布，此處僅標示鄰近沿海位置供參考</div>`;
  }

  tooltip.classList.remove("hidden");
  if (evt) positionTooltipNearCursor(evt, "typhoonMapTooltip", "typhoonMapWrap");
}

function renderTyphoonMap(alerts) {
  const section = el("typhoonMapSection");
  const emptyEl = el("typhoonMapEmpty");
  const activeTyphoonAlerts = (alerts || []).filter((a) => a.source === "typhoon" && a.isActive);

  const landCounties = new Set();
  const seaCounties = new Set();
  const seaAreasByCounty = new Map();
  for (const a of activeTyphoonAlerts) {
    (a.landCounties || []).forEach((c) => landCounties.add(c));
    (a.seaCounties || []).forEach((c) => seaCounties.add(c));
    const seaCountyAreas = a.seaCountyAreas || {};
    for (const county of Object.keys(seaCountyAreas)) {
      if (!seaAreasByCounty.has(county)) seaAreasByCounty.set(county, new Set());
      const set = seaAreasByCounty.get(county);
      seaCountyAreas[county].forEach((areaName) => set.add(areaName));
    }
  }
  latestTyphoonLandCounties = landCounties;
  latestTyphoonSeaCounties = seaCounties;
  latestTyphoonSeaAreasByCounty = seaAreasByCounty;

  const hasAny = landCounties.size > 0 || seaCounties.size > 0;
  section.classList.toggle("hidden", !hasAny);
  emptyEl.classList.toggle("hidden", hasAny);
  if (!hasAny) {
    hideTyphoonMapTooltip();
    return;
  }

  buildTyphoonMap();

  // 陸上颱風警報：整個縣市塗紅（跟以前一樣）。
  // 海上颱風警報：改成畫在該縣市「朝海那一側」的台灣邊界外圍（見
  // gen_sea_outline2.py 事先用幾何差集算出的 .alert-sea-outline / -casing），
  // 縣市本身不再整塊塗黃，只有沿海那段邊界線變粗、變黃，比較不會誤會成
  // 「整個縣市都在海上警報範圍」。
  document.querySelectorAll(TYPHOON_ZONE_SELECTOR).forEach((path) => {
    const county = path.dataset.county;
    const color = landCounties.has(county) ? TYPHOON_LAND_COLOR : "#ffffff";
    path.style.fill = color;
    // 跟 renderAlertMap 一樣，把邊框顏色蓋成跟填色同色，蓋掉相鄰鄉鎮
    // 交界處的反鋸齒細縫，這樣同一縣市內部就不會看到鄉鎮市區的界線，
    // 只留下 .alert-county-outline／.alert-inset-outline 那層的縣市界線。
    path.style.stroke = color;
    // 只有「這個縣市有陸上颱風警報」時，滑鼠碰到陸地色塊才要有反應（變暗）；
    // 沒有陸上警報（不管有沒有海上警報）的縣市，陸地本身滑鼠碰到要完全沒
    // 反應，靠這個 class 讓 CSS 的 hover 變暗效果只在有陸上警報時生效。
    path.classList.toggle("has-land-alert", landCounties.has(county));
  });

  document
    .querySelectorAll("#typhoonMapHolder .alert-sea-outline-casing, #typhoonMapHolder .alert-sea-outline")
    .forEach((p) => p.classList.toggle("active", seaCounties.has(p.dataset.county)));

  const legend = el("typhoonMapLegend");
  const items = [];
  if (landCounties.size) {
    items.push(
      `<div class="alert-map-legend-item"><span class="alert-map-legend-swatch" style="background:${TYPHOON_LAND_COLOR}"></span><span>陸上颱風警報</span></div>`
    );
  }
  if (seaCounties.size) {
    items.push(
      `<div class="alert-map-legend-item"><span class="alert-map-legend-swatch alert-map-legend-swatch--line" style="background:${TYPHOON_SEA_COLOR}"></span><span>海上颱風警報（鄰近沿海縣市邊界，僅供參考）</span></div>`
    );
  }
  legend.innerHTML = items.join("");
}

// 把「山區」或「平地」那一組地區，依等級（顏色）分段列出，同等級的合成一行避免太長
function renderAreaGroup(label, areas) {
  if (!areas || areas.length === 0) return "";
  // 依等級分段（areas 已經是依等級排序過的）
  const segments = [];
  let cur = null;
  for (const a of areas) {
    if (!cur || cur.level !== a.level) {
      cur = { level: a.level, color: a.color || RAIN_LEVEL_FALLBACK_COLOR[a.level], names: [] };
      segments.push(cur);
    }
    cur.names.push(a.name);
  }
  const rows = segments
    .map(
      (seg) => `
      <div class="rain-level-row">
        <span class="rain-level-chip" style="${rainChipStyle(seg.color, seg.level)}">${seg.level}</span>
        <span class="rain-level-areas">${seg.names.join("、")}</span>
      </div>`
    )
    .join("");
  return `
    <div class="rain-area-group">
      <div class="rain-area-group-title">${label}（${areas.length}）</div>
      ${rows}
    </div>`;
}

function renderRainAlertCard(alert) {
  const item = document.createElement("div");
  item.className = "alert-item" + (alert.isActive ? "" : " alert-item-cancelled");
  const barColor = alert.color || RAIN_LEVEL_FALLBACK_COLOR[alert.severityLevel] || "#7f8c9a";
  item.style.setProperty("--alert-color", barColor);

  item.innerHTML = `
    <div class="alert-row">
      <span class="alert-row-dot"></span>
      <span class="alert-row-title">${alert.alertTitle || "大雨(豪雨)特報"}</span>
      <span class="alert-row-status">${alert.isActive ? "生效中" : "已解除"}</span>
      <button class="alert-detail-btn" type="button">詳細資訊</button>
    </div>
    <div class="alert-detail hidden">
      <p class="alert-detail-desc">${alert.description || "（沒有更多說明）"}</p>
      <p class="alert-detail-time">發布 ${formatAlertTime(alert.sent)}　　有效至 ${formatAlertTime(alert.expires)}</p>
    </div>
  `;
  wireAlertItemToggle(item, { showMap: true });
  return item;
}

function renderAlertCard(alert) {
  if (alert.source === "rain") return renderRainAlertCard(alert);

  const item = document.createElement("div");
  item.className = "alert-item" + (alert.isActive ? "" : " alert-item-cancelled");
  const barColor = alert.color || ALERT_SEVERITY_FALLBACK_COLOR[alert.severity] || "#7f8c9a";
  item.style.setProperty("--alert-color", barColor);

  const areasPreview =
    alert.areas && alert.areas.length
      ? alert.areas.length > 6
        ? alert.areas.slice(0, 6).join("、") + ` 等 ${alert.areas.length} 個地區`
        : alert.areas.join("、")
      : "全國";

  item.innerHTML = `
    <div class="alert-row">
      <span class="alert-row-dot"></span>
      <span class="alert-row-title">${alert.alertTitle || alert.headline || alert.event || "警特報"}</span>
      <span class="alert-row-status">${alert.isActive ? "生效中" : "已解除"}</span>
      <button class="alert-detail-btn" type="button">詳細資訊</button>
    </div>
    <div class="alert-detail hidden">
      <p class="alert-detail-desc">${alert.description || "（沒有更多說明）"}</p>
      <p class="alert-detail-areas">影響地區：${areasPreview}</p>
      <p class="alert-detail-time">發布 ${formatAlertTime(alert.sent)}　　有效至 ${formatAlertTime(alert.expires)}</p>
    </div>
  `;
  wireAlertItemToggle(item, { showMap: false });
  return item;
}

// 點「詳細資訊」按鈕：原地展開/收合顯示那則自己的完整內容（文字），
// 大雨特報還會多帶出「大雨(豪雨)特報縣市分布圖」（圖表），收合時一起收起來；
// 卡片本身只是靜態顯示標題跟狀態，不會整排都可以點。
function wireAlertItemToggle(item, options) {
  const opts = options || {};
  const btn = item.querySelector(".alert-detail-btn");
  const detail = item.querySelector(".alert-detail");
  btn.addEventListener("click", () => {
    const isOpen = item.classList.toggle("alert-item-open");
    detail.classList.toggle("hidden", !isOpen);
    btn.textContent = isOpen ? "收起" : "詳細資訊";
    if (opts.showMap) {
      const mapSection = el("alertMapSection");
      if (mapSection && alertMapHasData) {
        mapSection.classList.toggle("hidden", !isOpen);
      }
    }
  });
}

function renderAlertsBadge(alerts) {
  const activeCount = (alerts || []).filter((a) => a.isActive).length;
  const badge = el("alertTabBadge");
  const toolsBadge = el("toolsAlertBadge");
  const banner = el("alertBanner");
  const bannerText = el("alertBannerText");

  if (activeCount > 0) {
    badge.textContent = String(activeCount);
    badge.classList.remove("hidden");
    if (toolsBadge) {
      toolsBadge.textContent = String(activeCount);
      toolsBadge.classList.remove("hidden");
    }
    banner.classList.remove("hidden");
    bannerText.textContent = `目前有 ${activeCount} 則警特報生效中`;
  } else {
    badge.classList.add("hidden");
    if (toolsBadge) toolsBadge.classList.add("hidden");
    banner.classList.add("hidden");
  }
}

async function loadAlerts() {
  const data = await window.weatherAPI.getAlerts();
  const alerts = (data && data.alerts) || [];
  const listEl = el("alertsList");
  const emptyEl = el("alertsEmpty");
  listEl.innerHTML = "";

  const active = alerts.filter((a) => a.isActive);
  if (active.length === 0) {
    emptyEl.classList.remove("hidden");
  } else {
    emptyEl.classList.add("hidden");
    active.forEach((a) => listEl.appendChild(renderAlertCard(a)));
  }

  el("alertsUpdateTime").textContent = data && data.updatedAt ? `更新時間：${formatAlertTime(data.updatedAt)}` : "";
  renderAlertsBadge(alerts);
  renderAlertMap(alerts);
  renderTyphoonMap(alerts);
}

async function loadTyphoonProbability() {
  const data = await window.weatherAPI.getTyphoonProbability();
  const section = el("typhoonProbSection");
  const bandsEl = el("typhoonProbBands");
  bandsEl.innerHTML = "";

  if (!data || !data.hasTyphoon || !data.bands || data.bands.length === 0) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  el("typhoonProbIssued").textContent = data.issuedAt ? `資料時間：${data.issuedAt}` : "";

  // 依百分比數字由高到低排序後，畫成一排色塊清單（不畫地圖疊圖，只顯示各機率等級）
  const sorted = [...data.bands].sort((a, b) => (parseInt(b.percent) || 0) - (parseInt(a.percent) || 0));
  sorted.forEach((band) => {
    const chip = document.createElement("div");
    chip.className = "typhoon-prob-chip";
    chip.textContent = `${band.percent}%`;
    bandsEl.appendChild(chip);
  });
}

el("refreshAlertsBtn").onclick = async () => {
  el("refreshAlertsBtn").disabled = true;
  try {
    await window.weatherAPI.forceRefreshAlerts();
    await loadAlerts();
    await loadTyphoonProbability();
  } finally {
    el("refreshAlertsBtn").disabled = false;
  }
};

el("alertBanner").onclick = () => {
  document.querySelector('.tab-btn[data-tab="alerts"]').click();
};

window.weatherAPI.onAlertsUpdated(() => {
  loadAlerts();
  const alertsPanelActive = el("alertsPanel").classList.contains("active");
  if (alertsPanelActive) loadTyphoonProbability();
});

// 啟動時就先讀一次快取，讓側邊欄警示 banner 一開機就能顯示（不用等使用者點警特報分頁）
loadAlerts();

// ---------------- Init ----------------
renderFavorites();

// 後台每 5 分鐘完成一輪輪詢後會推播這個事件；若目前正看著某縣市，順便刷新畫面。
window.weatherAPI.onUpdated(() => {
  if (currentCity) selectCity(currentCity.label);
});

(async () => {
  const hasKey = await refreshApiKeyStatus();
  if (!hasKey) {
    setStatus("尚未設定 CWA 授權碼，請聯絡後台管理員設定");
  } else if (favorites.length > 0) {
    selectCity(favorites[0].label);
  } else {
    setTimeout(autoLocate, 300);
  }
})();

// ---------------- 手機版側欄抽屜 ----------------
// 整個側欄（城市選擇／收藏城市等）手機版預設收起來，點主畫面左上角
// 的漢堡選單才滑出來，點遮罩或選了城市之後自動收回去。
function openSidebarDrawer() {
  el("sidebar").classList.add("drawer-open");
  el("sidebarDrawerOverlay").classList.add("open");
}
function closeSidebarDrawer() {
  el("sidebar").classList.remove("drawer-open");
  el("sidebarDrawerOverlay").classList.remove("open");
}
const drawerBtn = el("sidebarDrawerBtn");
if (drawerBtn) drawerBtn.addEventListener("click", openSidebarDrawer);
const drawerOverlay = el("sidebarDrawerOverlay");
if (drawerOverlay) drawerOverlay.addEventListener("click", closeSidebarDrawer);
// 查詢天氣／自動定位按下去之後，手機版順手把抽屜收起來，直接看結果
const searchBtnEl = el("searchBtn");
if (searchBtnEl) searchBtnEl.addEventListener("click", closeSidebarDrawer);
const locateBtnEl = el("locateBtn");
if (locateBtnEl) locateBtnEl.addEventListener("click", closeSidebarDrawer);

// ---------------- 底部導覽列 ----------------
// 對應參考設計的手機底部導覽列（拿掉「地震」，目前沒有這個功能）。
// 「首頁」「颱風」直接對應原本就有的分頁按鈕；「工具」先捲動到分頁列讓使用者
// 自己挑（溫度趨勢圖／多城市比較／地圖選點）；「設定」目前還沒有實際設定頁，
// 先提示開發中，避免點了沒反應。
function setBottomNavActive(key) {
  document.querySelectorAll(".bottom-nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.bottom === key);
  });
  if (window.moveBottomNavIndicator) window.moveBottomNavIndicator(key);
}

// 真正「切換分頁」該做的事（更新樣式 + 換內容），跟純視覺預覽分開，
// 這樣手指滑過中間按鈕時可以只換外觀預覽，放開才真正觸發換頁，
// 不會滑過去時每顆分頁的內容都被觸發一次。
function activateBottomNavKey(key) {
  if (key === "tools") {
    if (window.closeSettingsMenu) window.closeSettingsMenu();
    toggleToolsMenu();
    return;
  }
  closeToolsMenu();
  if (key !== "settings" && window.closeSettingsMenu) window.closeSettingsMenu();
  setBottomNavActive(key);
  if (key === "home") {
    document.querySelector('.tab-btn[data-tab="forecast"]').click();
    document.querySelector(".main").scrollTo({ top: 0, behavior: "smooth" });
  } else if (key === "typhoon") {
    // 先看已發佈的警特報清單，想看颱風地圖詳情的話從清單裡點進去
    document.querySelector('.tab-btn[data-tab="alerts"]').click();
  } else if (key === "settings") {
    if (window.openSettingsMenu) window.openSettingsMenu();
  }
}

// ---------------- 底部導覽列：會滑動變形的液態玻璃指示器 ----------------
// 只有一顆指示器（.bottom-nav-indicator），切換分頁時用兩段式動畫移動它：
// 第一段先「拉長」成同時蓋住舊位置跟新位置的長條（看起來像液態被拉伸跨過中間
// 的按鈕），第二段再彈性收縮回新按鈕的大小，模擬液態玻璃流動、Q 彈的質感。
(function setupBottomNavIndicator() {
  const nav = el("bottomNav");
  const indicator = el("bottomNavIndicator");
  if (!nav || !indicator) return;

  function rectFor(btn) {
    const icon = btn.querySelector(".bottom-nav-icon");
    if (!icon) return null;
    const iconRect = icon.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    return {
      left: iconRect.left - navRect.left - 14,
      top: iconRect.top - navRect.top - 4,
      width: iconRect.width + 28,
      height: iconRect.height + 8,
    };
  }

  function place(rect) {
    indicator.style.left = rect.left + "px";
    indicator.style.top = rect.top + "px";
    indicator.style.width = rect.width + "px";
    indicator.style.height = rect.height + "px";
  }

  function moveTo(key, animate) {
    const btn = nav.querySelector('.bottom-nav-btn[data-bottom="' + key + '"]');
    if (!btn) return;
    const target = rectFor(btn);
    if (!target) return;

    if (!animate) {
      indicator.style.transition = "none";
      place(target);
      void indicator.offsetWidth; // 強制 reflow，讓下一次移動能重新套用 transition
      indicator.style.transition = "";
      indicator.classList.add("ready");
      return;
    }

    const prevLeft = parseFloat(indicator.style.left || target.left);
    const prevWidth = parseFloat(indicator.style.width || target.width);
    const bridgeLeft = Math.min(prevLeft, target.left);
    const bridgeRight = Math.max(prevLeft + prevWidth, target.left + target.width);

    // 第一段：拉長，同時涵蓋起點與終點
    indicator.style.transition =
      "left 0.16s cubic-bezier(.22,.7,.2,1), width 0.16s cubic-bezier(.22,.7,.2,1), top 0.2s ease, height 0.2s ease";
    indicator.style.left = bridgeLeft + "px";
    indicator.style.width = bridgeRight - bridgeLeft + "px";
    indicator.style.top = target.top + "px";
    indicator.style.height = target.height + "px";

    window.setTimeout(() => {
      // 第二段：彈性收縮回新按鈕的實際大小
      indicator.style.transition =
        "left 0.24s cubic-bezier(.34,1.56,.64,1), width 0.24s cubic-bezier(.34,1.56,.64,1)";
      indicator.style.left = target.left + "px";
      indicator.style.width = target.width + "px";
    }, 150);
  }

  window.moveBottomNavIndicator = function (key) {
    moveTo(key, true);
  };

  function currentActiveKey() {
    const activeBtn = nav.querySelector(".bottom-nav-btn.active");
    return activeBtn ? activeBtn.dataset.bottom : "home";
  }

  window.addEventListener("load", () => moveTo(currentActiveKey(), false));
  window.addEventListener("resize", () => moveTo(currentActiveKey(), false));
})();

// 偵測瀏覽器是否真的支援「SVG filter 當 backdrop-filter 用」（目前主要是
// Chromium 系）。有支援才加上折射效果的 class；Safari 等不支援的瀏覽器
// 偵測不到就維持原本的霧面玻璃樣式，不會整條導覽列跑掉或消失。
(function detectLiquidGlassRefractionSupport() {
  try {
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.width = "0";
    probe.style.height = "0";
    probe.style.pointerEvents = "none";
    probe.style.backdropFilter = "blur(0px) url(#liquidGlassNav)";
    document.body.appendChild(probe);
    const applied = getComputedStyle(probe).backdropFilter || "";
    document.body.removeChild(probe);
    if (applied.indexOf("url") !== -1) {
      const nav = el("bottomNav");
      if (nav) nav.classList.add("liquid-glass-refraction");
    }
  } catch (e) {
    /* 偵測失敗就當作不支援，安全退回霧面玻璃 */
  }
})();

// ---------------- 底部導覽列：手勢 ----------------
// 導覽列固定貼在畫面底部，不能再拖著移動位置；保留「按著滑過去」
// 直接切換分頁的手勢（滑到哪顆，指示器跟著預覽到哪顆；放開手指才
// 真的觸發換頁內容，不會滑過去沿路每顆都觸發）。
const SCRUB_THRESHOLD = 6; // 超過這個位移就判定使用者要滑動，而不是單純點一下

// 清掉之前「可拖曳移動」時代留下的位置記錄，讓它固定回底部
try {
  localStorage.removeItem("bottomNavPosition");
} catch (e) {
  /* 存取失敗就算了 */
}

(function setupBottomNavGestures() {
  const nav = el("bottomNav");
  if (!nav) return;

  // mode: null（還沒判斷）、"scrub"（滑動切換分頁）
  let mode = null;
  let startX = 0;
  let startY = 0;
  let activePointerId = null;
  let previewKey = null;
  let startKey = null;

  function keyAtPoint(clientX) {
    const buttons = nav.querySelectorAll(".bottom-nav-btn");
    let hit = null;
    let nearest = null;
    let nearestDist = Infinity;
    buttons.forEach((btn) => {
      const rect = btn.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) {
        hit = btn.dataset.bottom;
      }
      const dist = Math.abs(clientX - (rect.left + rect.width / 2));
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = btn.dataset.bottom;
      }
    });
    return hit || nearest;
  }

  nav.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const btn = event.target.closest(".bottom-nav-btn");
    startX = event.clientX;
    startY = event.clientY;
    startKey = btn ? btn.dataset.bottom : null;
    previewKey = startKey;
    mode = null;
    activePointerId = event.pointerId;
    nav.setPointerCapture(event.pointerId);
  });

  nav.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (mode === null && Math.hypot(dx, dy) > SCRUB_THRESHOLD) {
      mode = "scrub";
    }

    if (mode === "scrub") {
      event.preventDefault();
      const key = keyAtPoint(event.clientX);
      if (key && key !== previewKey) {
        previewKey = key;
        document.querySelectorAll(".bottom-nav-btn").forEach((b) => {
          b.classList.toggle("active", b.dataset.bottom === key);
        });
        if (window.moveBottomNavIndicator) window.moveBottomNavIndicator(key);
      }
    }
  });

  function endGesture(event) {
    if (event.pointerId !== activePointerId) return;
    if (mode === "scrub" && previewKey) activateBottomNavKey(previewKey);
    mode = null;
    previewKey = null;
    startKey = null;
    activePointerId = null;
  }

  nav.addEventListener("pointerup", endGesture);
  nav.addEventListener("pointercancel", (event) => {
    // 手勢被系統打斷：預覽要復原成原本真正選到的分頁，不要誤觸發換頁
    if (event.pointerId !== activePointerId) return;
    if (mode === "scrub") {
      const activeBtn = nav.querySelector(".bottom-nav-btn.active");
      const revertKey = startKey || (activeBtn ? activeBtn.dataset.bottom : "home");
      document.querySelectorAll(".bottom-nav-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.bottom === revertKey);
      });
      if (window.moveBottomNavIndicator) window.moveBottomNavIndicator(revertKey);
    }
    mode = null;
    previewKey = null;
    startKey = null;
    activePointerId = null;
  });

  // 滑動放開那一下瀏覽器還是會補發 click，這裡擋掉避免誤觸按鈕
  nav.addEventListener(
    "click",
    (event) => {
      if (mode !== null) {
        event.stopPropagation();
        event.preventDefault();
      }
    },
    true
  );
})();

// ---------------- 底部導覽列：往下捲自動縮小、往上捲或點按恢復 ----------------
(function setupBottomNavAutoCollapse() {
  const nav = el("bottomNav");
  if (!nav) return;

  const DELTA_THRESHOLD = 6; // 累積捲動超過這個距離才判定方向，避免手抖誤判
  const MIN_SCROLL_TOP = 40; // 太靠頁面頂端就不縮，避免一開始滑一點點就縮起來

  function getScrollTop() {
    // 手機版是整個網頁在捲（.main 在手機版是 overflow-y: visible），
    // 桌面版才是 .main 自己捲動，兩種都兼顧。
    const mainEl = document.querySelector(".main");
    const mainScroll = mainEl ? mainEl.scrollTop : 0;
    const pageScroll = window.scrollY || document.documentElement.scrollTop || 0;
    return Math.max(mainScroll, pageScroll);
  }

  let anchorScrollTop = getScrollTop();

  function handleScroll() {
    const current = getScrollTop();
    const diff = current - anchorScrollTop;

    if (current <= MIN_SCROLL_TOP) {
      nav.classList.remove("bottom-nav-collapsed");
      anchorScrollTop = current;
    } else if (diff > DELTA_THRESHOLD) {
      nav.classList.add("bottom-nav-collapsed"); // 累積往下捲夠多：縮小
      anchorScrollTop = current; // 觸發後重設基準點，才能偵測下一次方向改變
    } else if (diff < -DELTA_THRESHOLD) {
      nav.classList.remove("bottom-nav-collapsed"); // 累積往上捲夠多：恢復
      anchorScrollTop = current;
    }
  }

  window.addEventListener("scroll", handleScroll, { passive: true });
  const mainEl = document.querySelector(".main");
  if (mainEl) mainEl.addEventListener("scroll", handleScroll, { passive: true });

  // 點按導覽列本身：不用等使用者往上滑，馬上恢復正常大小
  nav.addEventListener("pointerdown", () => {
    nav.classList.remove("bottom-nav-collapsed");
  });
})();

document.querySelectorAll(".bottom-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => activateBottomNavKey(btn.dataset.bottom));
});

function toggleToolsMenu() {
  const isOpen = el("toolsMenu").classList.contains("open");
  if (isOpen) closeToolsMenu();
  else openToolsMenu();
}
function openToolsMenu() {
  el("toolsMenu").classList.add("open");
  el("toolsMenuOverlay").classList.add("open");
  setBottomNavActive("tools");
}
function closeToolsMenu() {
  el("toolsMenu").classList.remove("open");
  el("toolsMenuOverlay").classList.remove("open");
}
el("toolsMenuOverlay").addEventListener("click", closeToolsMenu);
el("toolsMenuCloseBtn").addEventListener("click", closeToolsMenu);
document.querySelectorAll(".tools-menu-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelector(`.tab-btn[data-tab="${item.dataset.tab}"]`).click();
    closeToolsMenu();
    document.querySelector(".main").scrollTo({ top: 0, behavior: "smooth" });
  });
});
