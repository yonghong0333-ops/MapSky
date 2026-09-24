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
  if (keyStatusEl) {
    keyStatusEl.classList.toggle("disconnected", !status.hasKey);
    const textEl = keyStatusEl.querySelector(".key-status-text");
    if (textEl) textEl.textContent = status.hasKey ? "已連線" : "尚未連線";
  }
  return apiKeyReady;
}

function loadFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; }
  catch { return []; }
}
function saveFavorites(favs) { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); }

let favorites = loadFavorites();
let currentCity = null;
let lastWeatherSnapshot = null; // { temp, wx, startTime }：動態島／sendToDynamicIsland 用 // { label } - label 就是 CWA 縣市名稱
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

// 晚上用的月亮圖示：自己畫的新月形狀，顏色跟 sunny.png 那顆太陽用同一個
// 顏色（#FFCC00，用滴管從那張圖直接量出來的），這樣白天／晚上圖示的用色
// 是一致的，只是形狀換掉，不會有「晚上突然變別的色系」的違和感。
function moonIcon() {
  return '<svg class="wx-icon-img" viewBox="0 0 24 24" fill="#FFCC00" xmlns="http://www.w3.org/2000/svg"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
}

function iconForWx(text, night) {
  if (!text) return "❓";
  if (text.includes("雪")) return "❄️";       // 無對應自訂圖示，沿用 emoji
  if (text.includes("霧")) return "🌫️";       // 無對應自訂圖示，沿用 emoji
  if (text.includes("超大豪雨")) return iconImg("extremeRain", text);
  if (text.includes("豪雨")) return iconImg("heavyRain", text);
  if (text.includes("毛毛雨")) return iconImg("drizzle", text);
  if (text.includes("雷") && text.includes("雨")) return iconImg("thunderstorm", text);
  if (text.includes("雷")) return iconImg("dryThunder", text);
  if (text.includes("雨")) return iconImg("rain", text);
  // 「多雲時晴」「晴天」這兩種圖示本身畫的是太陽，晚上時段還顯示太陽不合理，
  // 改用上面自畫的月亮圖示（同色系），比一直顯示太陽正確。
  if (night && text.includes("多雲") && text.includes("晴")) return moonIcon();
  if (text.includes("多雲") && text.includes("晴")) return iconImg("partlyCloudy", text);
  if (text.includes("陰")) return iconImg("overcast", text);
  if (text.includes("多雲")) return iconImg("overcast", text); // 無專屬圖示，沿用陰天圖示
  if (night && text.includes("晴")) return moonIcon();
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
  updateFavStar();
}

// 星星圖示狀態：目前這個城市有沒有被收藏，收藏了就顯示黃色實心星星
function updateFavStar() {
  const outlineIcon = el("favStarOutline");
  const filledIcon = el("favStarFilled");
  if (!outlineIcon || !filledIcon) return;
  const isFav = Boolean(currentCity) && favorites.some((f) => f.label === currentCity.label);
  outlineIcon.classList.toggle("hidden", isFav);
  filledIcon.classList.toggle("hidden", !isFav);
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
  const already = favorites.some((f) => f.label === currentCity.label);
  if (already) {
    favorites = favorites.filter((f) => f.label !== currentCity.label);
    saveFavorites(favorites);
    renderFavorites();
    setStatus(`已將「${currentCity.label}」從收藏移除`);
    return;
  }
  favorites.push({ label: currentCity.label });
  saveFavorites(favorites);
  renderFavorites();
  setStatus(`已將「${currentCity.label}」加入收藏`);
};

// （分享按鈕已經從畫面拿掉：index.html 不再有 #shareWeatherBtn，下面有防空值判斷，所以這段不會執行。）
// 分享目前天氣：呼叫 Web Share API 跳出手機原生的分享清單（LINE、訊息、
// Instagram 這些），不支援的瀏覽器（例如桌面版）就退回複製文字。
const shareWeatherBtn = el("shareWeatherBtn");
if (shareWeatherBtn) {
  shareWeatherBtn.addEventListener("click", async () => {
    if (!currentCity) return;
    const tempEl = el("currentTemp");
    const descEl = el("currentDesc");
    const temp = (tempEl && tempEl.textContent) || "";
    const desc = (descEl && descEl.textContent) || "";
    const text = `${currentCity.label}天氣　${temp}　${desc}`;
    const url = window.location.origin + window.location.pathname;

    if (navigator.share) {
      try {
        await navigator.share({ title: "MapSky 天氣", text, url });
      } catch (e) {
        /* 使用者自己取消分享，不用特別處理 */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setStatus("天氣資訊已複製，可以貼到任何地方分享");
    } catch (e) {
      setStatus("這個瀏覽器不支援分享功能");
    }
  });
}

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

// 桌面版：直接讀作業系統的定位，不退回 IP 定位。IP 只準到縣市，在台灣常被判成台北，
// 會悄悄選到錯的縣市；抓不到系統定位時寧可明確告訴使用者原因，也不要亂猜。
// window.mapskyLocation 只有 Electron 桌面版的 preload 才會提供，手機版／網頁版不會走這裡。
const LAST_LOCATED_KEY = "mapsky_last_located_city";

async function autoLocateDesktop() {
  setStatus("正在讀取系統定位…");
  // 系統定位（尤其開機後第一次、或沒有 GPS 的桌機）有時要等十幾秒；先給個提示，
  // 避免看起來像當掉。第一次使用時 macOS 會跳出授權視窗，也要等使用者按允許。
  let done = false;
  let provisionalCity = null;
  const hint = (text) => setStatus(provisionalCity ? `先用網路位置概略判斷為「${provisionalCity}」；${text}` : text);
  const slowTimers = [
    // 等了 5 秒系統還沒回，而且畫面上還沒有任何城市（沒有上次定位／收藏可以先顯示）時，
    // 先用外殼的網路位置（座標反查，比只看地區名準）暫時顯示，不要讓主畫面一直空著；
    // 系統定位一回來就會被準確的結果取代。畫面上已經有城市就不動它。
    setTimeout(async () => {
      if (done || currentCity) return;
      try {
        const r = await window.mapskyLocation.lookup(null);
        if (done || currentCity || !r || !r.place) return;
        let m = null;
        for (const part of String(r.place).split(" ")) {
          m = matchCwaCity(part);
          if (m) break;
        }
        if (!m) return;
        provisionalCity = m;
        el("citySelect").value = m;
        selectCity(m);
        hint("仍在等系統定位…");
      } catch (e) { /* 拿不到就維持等待 */ }
    }, 5000),
    setTimeout(() => hint("系統定位回應較慢，仍在等待…"), 8000),
    setTimeout(() => hint("還在等系統定位；若跳出授權視窗請按「允許」，或到系統設定確認 MapSky 的定位權限"), 20000),
  ];
  const clearSlow = () => { done = true; slowTimers.forEach(clearTimeout); };
  let pos;
  try {
    pos = await new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("no geolocation"));
        return;
      }
      // 只要縣市層級，不需要高精度，用一般模式比較快（Wi-Fi 定位即可）
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 5 * 60 * 1000,
      });
    });
  } catch (e) {
    clearSlow();
    let reason = "無法取得系統定位";
    if (e && e.code === 1) reason = "系統已拒絕 MapSky 使用定位";
    else if (e && e.code === 3) reason = "系統定位逾時";
    const note = provisionalCity ? `（目前顯示的是網路位置概略判斷的「${provisionalCity}」）` : "";
    setStatus(`${reason}，請到「系統設定 → 隱私權與安全性 → 定位服務」開啟 MapSky，或手動選擇縣市${note}`);
    return;
  }

  clearSlow();
  setStatus("定位成功，正在比對縣市…");
  const { latitude, longitude } = pos.coords;
  let matched = null;

  // 1) 交給外殼（主行程）反查地名：標題列的所在地就是走這條路，有帶識別用的 User-Agent，
  //    比網頁自己去打 Nominatim 穩定。回傳像「高雄市 前鎮區」，逐段去比對 22 縣市。
  try {
    const r = await window.mapskyLocation.lookup({ lat: latitude, lon: longitude });
    if (r && r.place) {
      for (const part of String(r.place).split(" ")) {
        matched = matchCwaCity(part);
        if (matched) break;
      }
    }
  } catch (e) { /* 換下一種方式 */ }

  // 2) 外殼查不到或對不上縣市，再用網頁端原本的反查方式（county 優先）
  if (!matched) {
    try {
      const url = `${GEOCODE_URL}?format=jsonv2&lat=${latitude}&lon=${longitude}` +
        `&accept-language=zh-TW&zoom=10`;
      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const addr = data.address || {};
      if (addr.country_code && addr.country_code !== "tw") {
        setStatus("目前定位不在台灣，中央氣象署資料僅涵蓋台灣地區，請手動選擇縣市");
        return;
      }
      matched = matchCwaCity(addr.county || addr.city || addr.state || addr.town || "");
    } catch (e) {
      setStatus(`定位成功，但地名比對失敗：${e.message}，請手動於下拉選單選擇縣市`);
      return;
    }
  }

  if (!matched) {
    setStatus("定位成功，但無法比對到支援的縣市，請手動於下拉選單選擇縣市");
    return;
  }
  try { localStorage.setItem(LAST_LOCATED_KEY, matched); } catch (e) {}
  el("citySelect").value = matched;
  if (currentCity && currentCity.label === matched) {
    setStatus(`定位完成：${matched}`);
  } else {
    selectCity(matched);
  }
}

async function autoLocate() {
  if (window.mapskyLocation && window.mapskyLocation.lookup) {
    return autoLocateDesktop();
  }
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
  tyMaybeForceForLocation(); // 警報資料如果比縣市先到，這裡補判斷（函式在下面定義，載入完才會被呼叫）
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
  loadUvIndex(label);
  loadMoonPhaseImage();
  loadWeeklyForecast(label);
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
    const days = sunTimesCache[label]; // [今天, 明天]
    const today = days && days[0];
    const tomorrow = days && days[1];
    if (!today || !today.SunRiseTime || !today.SunSetTime) return;
    const labelEl = el("sunTimesLabel");
    const iconEl = el("sunTimesIcon");
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const toMinutes = (hhmm) => {
      const [h, m] = hhmm.split(":").map(Number);
      return h * 60 + m;
    };
    const riseMinutes = toMinutes(today.SunRiseTime);
    const setMinutes = toMinutes(today.SunSetTime);
    const formatRemaining = (mins) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      if (h > 0 && m > 0) return `${h}小時${m}分`;
      if (h > 0) return `${h}小時`;
      return `${m}分`;
    };

    // 標籤（原本固定顯示「日出／日落」）改成動態顯示倒數剩餘時間；
    // 下面數值那行只留時間本身，不放圖示也不放「升起／落下」文字。
    // 圖示：晚上（不管是日出前的凌晨，還是日落後的夜晚）用向上箭頭的
    // sunrise.png；白天（日出後、日落前）用向下箭頭的 sunset.png。
    // 今天日落已經過了的話，直接跨到明天的日出繼續倒數，不會卡在「已日落」。
    if (nowMinutes < riseMinutes) {
      if (labelEl) labelEl.textContent = formatRemaining(riseMinutes - nowMinutes);
      valueEl.textContent = today.SunRiseTime;
      if (iconEl) iconEl.src = "icons/sunrise.png";
    } else if (nowMinutes < setMinutes) {
      if (labelEl) labelEl.textContent = formatRemaining(setMinutes - nowMinutes);
      valueEl.textContent = today.SunSetTime;
      if (iconEl) iconEl.src = "icons/sunset.png";
    } else if (tomorrow && tomorrow.SunRiseTime) {
      const nextRiseMinutes = toMinutes(tomorrow.SunRiseTime) + 24 * 60;
      if (labelEl) labelEl.textContent = formatRemaining(nextRiseMinutes - nowMinutes);
      valueEl.textContent = tomorrow.SunRiseTime;
      if (iconEl) iconEl.src = "icons/sunrise.png";
    } else {
      if (labelEl) labelEl.textContent = "已日落";
      valueEl.textContent = today.SunSetTime;
      if (iconEl) iconEl.src = "icons/sunrise.png";
    }
    valueEl.classList.remove("current-stat-empty");
  } catch (e) {
    /* 拿不到就維持「暫無資料」，不影響其他功能 */
  }
}

// ---------------- 月出／月落 ----------------
// 有些日子月亮不會升起或落下（極少數情形），對應欄位是空字串，顯示成「--」。
let moonTimesCache = null;
let moonTimesCacheDate = ""; // 快取對應的日期，跨日就要重抓
async function loadMoonTimes(label) {
  const valueEl = el("moonTimesValue");
  if (!valueEl) return;
  try {
    // 資料是「今天、明天」兩天份；網頁開著過了午夜，舊快取裡的「今天」就變成昨天了，
    // 所以日期一換就重新抓（伺服器端另外有快取，不會每分鐘都打氣象署）。
    const todayKey = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD（裝置本地日期）
    if (!moonTimesCache || moonTimesCacheDate !== todayKey) {
      const result = await window.weatherAPI.getMoonTimes();
      if (!result || !result.ok) return;
      moonTimesCache = result.counties || {};
      moonTimesCacheDate = todayKey;
    }
    const days = moonTimesCache[label]; // [今天, 明天]
    const today = days && days[0];
    const tomorrow = days && days[1];
    if (!today) return;
    const rise = today.MoonRiseTime || "";
    const set = today.MoonSetTime || "";
    const nextRise = tomorrow && tomorrow.MoonRiseTime ? tomorrow.MoonRiseTime : "";
    if (!rise && !set && !nextRise) return; // 完全沒資料（極少數情形），維持「暫無資料」

    const labelEl = el("moonTimesLabel");
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const toMinutes = (hhmm) => {
      const [h, m] = hhmm.split(":").map(Number);
      return h * 60 + m;
    };
    const formatRemaining = (mins) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      if (h > 0 && m > 0) return `${h}小時${m}分`;
      if (h > 0) return `${h}小時`;
      return `${m}分`;
    };

    // 月亮每天都比前一天晚約 50 分鐘升起，所以同一個日曆日裡「月落」可能排在「月出」
    // 前面（例如 9/21：00:32 月落、14:30 月出），不能像太陽那樣假設「先出、後落」。
    // 正確做法：把今天和明天的月出、月落全部攤平成一條時間軸，找「現在之後的下一個事件」：
    //   月出之前 → 顯示月出；月亮在天上 → 顯示月落（可能是明天凌晨）。
    // 標籤只留倒數的時間長度，不加文字說明（跟日出/日落一致）。
    const events = [];
    const pushEvent = (type, dayOffset, hhmm) => {
      if (hhmm) events.push({ type, hhmm, mins: dayOffset * 24 * 60 + toMinutes(hhmm) });
    };
    pushEvent("rise", 0, rise);
    pushEvent("set", 0, set);
    if (tomorrow) {
      pushEvent("rise", 1, tomorrow.MoonRiseTime || "");
      pushEvent("set", 1, tomorrow.MoonSetTime || "");
    }
    events.sort((a, b) => a.mins - b.mins);
    const next = events.find((e) => e.mins > nowMinutes);
    if (next) {
      if (labelEl) labelEl.textContent = formatRemaining(next.mins - nowMinutes);
      valueEl.textContent = next.hhmm;
    } else {
      // 兩天的事件都過了（理論上不會發生）：顯示最後一個事件
      const last = events[events.length - 1];
      if (labelEl) labelEl.textContent = last.type === "set" ? "已落下" : "";
      valueEl.textContent = last.hhmm;
    }
    valueEl.classList.remove("current-stat-empty");
  } catch (e) {
    /* 拿不到就維持「暫無資料」，不影響其他功能 */
  }
}

// 每分鐘重新算一次月出/月落倒數，跟日出/日落一樣不用手動重新整理。
setInterval(() => {
  if (currentCity && currentCity.label) {
    loadMoonTimes(currentCity.label);
  }
}, 60 * 1000);

// ---------------- 未來 7 天預報 ----------------
// 同一批資料涵蓋全臺所有縣市，跟日出/日落、月出/月落同樣邏輯：整批快取起來，
// 切換城市只要重新查表就好，不用每次都重打 API。
let weeklyForecastCache = null;
async function loadWeeklyForecast(label) {
  const listEl = el("weeklyForecastList");
  if (!listEl) return;
  try {
    if (!weeklyForecastCache) {
      const result = await window.weatherAPI.getWeeklyForecast();
      if (!result || !result.ok) return; // 保持「載入中」文字，不用特別報錯打擾使用者
      weeklyForecastCache = result.counties || {};
    }
    const periods = weeklyForecastCache[label];
    if (!periods || !periods.length) return;

    // 原始資料是每 12 小時一筆（白天／晚上各一筆），這裡依日期彙總成「一天一列」：
    // 高溫、低溫各取當天兩個時段的極值，天氣描述優先採用白天（06:00-18:00）那筆，
    // 降雨機率取當天兩時段較高的那個（比較保守，比較不會漏掉會下雨的提醒）。
    const byDate = new Map(); // date -> { date, dayPeriod, high, low, pop }
    for (const p of periods) {
      if (!p.startTime) continue;
      const d = new Date(p.startTime.replace("+08:00", ""));
      const dateKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      const hour = d.getHours();
      const isDaytime = hour < 18; // 06:00 起的那筆算白天，18:00 起的那筆算晚上
      const toNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null; // CWA 資料在較遠的天數常是 "-"（無資料），別讓 NaN 混進畫面
      };
      const maxT = toNum(p.maxTemp);
      const minT = toNum(p.minTemp);
      const popT = toNum(p.pop);

      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, { dateObj: d, high: maxT, low: minT, pop: popT, weather: p.weather, hasDaytime: isDaytime });
      } else {
        const row = byDate.get(dateKey);
        if (maxT !== null && (row.high === null || maxT > row.high)) row.high = maxT;
        if (minT !== null && (row.low === null || minT < row.low)) row.low = minT;
        if (popT !== null && (row.pop === null || popT > row.pop)) row.pop = popT;
        // 白天那筆的天氣描述優先蓋掉晚上那筆，這樣圖示/文字比較符合一般人對「今天天氣」的認知
        if (isDaytime && !row.hasDaytime) {
          row.weather = p.weather;
          row.hasDaytime = true;
        }
      }
    }
    const days = Array.from(byDate.values());
    if (!days.length) return;

    // 整週的溫度範圍，拿來算每一列的溫度長條要畫在哪個相對位置
    const allTemps = days.flatMap((d) => [d.high, d.low]).filter((v) => v !== null);
    const weekMin = Math.min(...allTemps);
    const weekMax = Math.max(...allTemps);
    const weekRange = weekMax - weekMin || 1;

    listEl.innerHTML = "";
    const weekdayFmt = new Intl.DateTimeFormat("zh-TW", { weekday: "short" });
    for (const d of days) {
      const dateLabel = `${d.dateObj.getMonth() + 1}/${d.dateObj.getDate()}\n${weekdayFmt.format(d.dateObj)}`;
      const high = d.high !== null ? Math.round(d.high) : null;
      const low = d.low !== null ? Math.round(d.low) : null;
      const leftPct = low !== null ? ((low - weekMin) / weekRange) * 100 : 0;
      const widthPct = high !== null && low !== null ? Math.max(((high - low) / weekRange) * 100, 6) : 0;

      const row = document.createElement("div");
      row.className = "seven-day-row";
      row.innerHTML = `
        <div class="sd-day">${dateLabel}</div>
        <div class="sd-icon">${iconForWx(d.weather || "")}</div>
        <div class="sd-low">${low ?? "--"}°</div>
        <div class="sd-bar"><div class="sd-bar-fill" style="left:${leftPct}%;width:${widthPct}%"></div></div>
        <div class="sd-high">${high ?? "--"}°</div>
        <div class="sd-pop">${d.pop ?? "--"}%</div>
      `;
      listEl.appendChild(row);
    }
  } catch (e) {
    const emptyEl = el("weeklyForecastEmpty");
    if (emptyEl) emptyEl.textContent = "暫無資料";
    /* 拿不到就維持「載入中」文字，不影響其他功能 */
  }
}

// ---------------- 後台管理 ----------------
// 只有 ADMIN_IDS 白名單內的帳號打得到 /api/weather/status?admin=1，
// 一般使用者這支 API 會拿到 403，這裡單純負責把資料畫出來。
let adminStatusLoaded = false;
async function loadAdminStatus() {
  if (adminStatusLoaded) return; // 系統狀態不用一直重打，開分頁時查一次就好
  const emptyEl = el("adminStatusEmpty");
  const contentEl = el("adminStatusContent");
  try {
    const resp = await fetch("/api/weather/status?admin=1");
    if (!resp.ok) {
      if (emptyEl) emptyEl.textContent = resp.status === 403 ? "你的帳號沒有後台管理權限。" : "載入失敗，請重新整理再試一次。";
      return;
    }
    const data = await resp.json();
    adminStatusLoaded = true;

    const meEl = el("adminMeInfo");
    if (meEl) meEl.textContent = `${data.me.name}（${data.me.provider}／id: ${data.me.id}）`;

    const sysEl = el("adminSystemInfo");
    if (sysEl) {
      const lines = [
        `CWA 授權碼：${data.hasKey ? "已設定 ✅" : "尚未設定 ❌"}`,
        `目前部署版本：${data.commit || "（本機開發，沒有 commit 資訊）"}`,
        `伺服器區域：${data.region || "（未知）"}`,
      ];
      sysEl.innerHTML = lines.join("<br>");
    }

    const providersEl = el("adminProvidersList");
    if (providersEl) {
      providersEl.innerHTML = data.providers
        .map((p) => `<div class="admin-provider-row"><span>${p.label}</span><span class="${p.configured ? "admin-ok" : "admin-off"}">${p.configured ? "已設定" : "未設定"}</span></div>`)
        .join("");
    }

    const cacheEl = el("adminCacheList");
    if (cacheEl) {
      cacheEl.innerHTML = Object.entries(data.cache)
        .map(([key, info]) => {
          const label = info.exists
            ? `${info.ageSeconds} 秒前（${info.fresh ? "新鮮" : "已過期"}）`
            : "尚無快取";
          return `<div class="admin-cache-row"><span>${key}</span><span>${label}</span></div>`;
        })
        .join("");
    }

    if (emptyEl) emptyEl.classList.add("hidden");
    if (contentEl) contentEl.classList.remove("hidden");

    const cooldownInput = el("adminCooldownInput");
    if (cooldownInput && typeof data.nicknameCooldownDays === "number") {
      cooldownInput.value = data.nicknameCooldownDays;
    }

    const maintenanceToggle = el("adminMaintenanceToggle");
    const maintenanceLabel = el("adminMaintenanceToggleLabel");
    if (maintenanceToggle) {
      maintenanceToggle.checked = Boolean(data.maintenanceMode);
      if (maintenanceLabel) maintenanceLabel.textContent = `目前：${data.maintenanceMode ? "開啟" : "關閉"}`;
    }

    // 管理員名單：只有超級管理員看得到跟能操作，一般管理員/一般使用者不會看到這張卡片
    renderAdminList(data);

    // 發送公告推播（一般管理員就能發）
    const pushForm = el("adminPushForm");
    const pushMsg = el("adminPushMsg");
    if (pushForm && !pushForm.dataset.bound) {
      pushForm.dataset.bound = "1";
      pushForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const title = el("adminPushTitle").value.trim();
        const body = el("adminPushBody").value.trim();
        if (!title || !body) return;
        const submitBtn = pushForm.querySelector("button[type=submit]");
        submitBtn.disabled = true;
        if (pushMsg) pushMsg.textContent = "發送中…";
        try {
          const resp = await fetch("/api/weather/status?admin=1&action=push-send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, body }),
          });
          const result = await resp.json();
          if (!resp.ok || !result.ok) {
            const reason = result.reason === "vapid-not-configured"
              ? "尚未設定 VAPID 金鑰（環境變數 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY）"
              : (result.reason || "發送失敗");
            if (pushMsg) pushMsg.textContent = `發送失敗：${reason}`;
            return;
          }
          if (pushMsg) pushMsg.textContent = `已發送給 ${result.sent} / ${result.total} 個裝置${result.expired ? `（清掉 ${result.expired} 個失效訂閱）` : ""}`;
          pushForm.reset();
        } catch (e) {
          if (pushMsg) pushMsg.textContent = "發送失敗，請重新整理再試一次。";
        } finally {
          submitBtn.disabled = false;
        }
      });
    }

    // 觸發桌面版重新編譯＋發佈（只有超級管理員看得到這張卡片，見 renderAdminList）
    const desktopBtn = el("adminDesktopPublishBtn");
    const desktopMsg = el("adminDesktopPublishMsg");
    if (desktopBtn && !desktopBtn.dataset.bound) {
      desktopBtn.dataset.bound = "1";
      desktopBtn.addEventListener("click", async () => {
        const channelSelect = el("adminDesktopChannelSelect");
        const channel = channelSelect ? channelSelect.value : "stable";
        const channelLabel = channelSelect ? channelSelect.options[channelSelect.selectedIndex].text : channel;
        if (!confirm(`確定要發佈「${channelLabel}」嗎？大約需要幾分鐘，且會實際發佈新版本給使用者。`)) return;
        desktopBtn.disabled = true;
        if (desktopMsg) desktopMsg.textContent = "觸發中…";
        try {
          const resp = await fetch("/api/weather/status?admin=1&action=publish-desktop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channel }),
          });
          const data = await resp.json();
          if (!resp.ok || !data.ok) {
            let reason = data.reason === "github-token-not-configured"
              ? "尚未設定環境變數 GITHUB_ACTIONS_TOKEN"
              : (data.reason || "觸發失敗");
            if (data.detail) reason += `（${data.detail}）`;
            if (desktopMsg) desktopMsg.textContent = `觸發失敗：${reason}`;
            return;
          }
          if (desktopMsg) desktopMsg.textContent = "已觸發，GitHub Actions 開始編譯，完成後會自動發佈到 Releases。";
        } catch (e) {
          if (desktopMsg) desktopMsg.textContent = "觸發失敗：網路錯誤";
        } finally {
          desktopBtn.disabled = false;
        }
      });
    }
  } catch (e) {
    if (emptyEl) emptyEl.textContent = "載入失敗，請重新整理再試一次。";
  }
}

// 管理員名單顯示 + 指派/踢除。只有超級管理員能操作（後端也一定會再檢查一次，
// 這裡沒判斷成功也不代表繞得過去，是體驗上先擋一次而已）。
function renderAdminList(data) {
  const card = el("adminManageCard");
  const desktopCard = el("adminDesktopCard");
  const betaCard = el("adminBetaCard");
  const skipCard = el("adminAdventureSkipCard");
  if (desktopCard) desktopCard.classList.toggle("hidden", !data.isSuperAdmin);
  if (betaCard) betaCard.classList.toggle("hidden", !data.isSuperAdmin || !data.betaTesters);
  if (betaCard && data.isSuperAdmin && data.betaTesters) {
    const betaListEl = el("adminBetaList");
    if (betaListEl) {
      betaListEl.innerHTML = data.betaTesters.length
        ? data.betaTesters
            .map(
              (t) =>
                `<div class="admin-list-row">
                  <span>🧪 ${t.name}（${t.key}）</span>
                  <button class="admin-beta-revoke-btn" data-provider="${t.provider}" data-id="${t.id}" type="button">移除</button>
                </div>`
            )
            .join("")
        : "<p class=\"admin-list-empty\">目前沒有人在公開測試版名單裡</p>";

      betaListEl.querySelectorAll(".admin-beta-revoke-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("確定要把這個帳號從公開測試版名單移除嗎？")) return;
          await callBetaAction("remove-beta-tester", { provider: btn.dataset.provider, id: btn.dataset.id });
        });
      });
    }
  }
  if (skipCard) skipCard.classList.toggle("hidden", !data.isSuperAdmin || !data.adventureSkipList);
  if (skipCard && data.isSuperAdmin && data.adventureSkipList) {
    const skipListEl = el("adminAdventureSkipList");
    if (skipListEl) {
      skipListEl.innerHTML = data.adventureSkipList.length
        ? data.adventureSkipList
            .map(
              (t) =>
                `<div class="admin-list-row">
                  <span>🏝️ ${t.name}（${t.key}）</span>
                  <button class="admin-adventure-skip-revoke-btn" data-provider="${t.provider}" data-id="${t.id}" type="button">移除</button>
                </div>`
            )
            .join("")
        : "<p class=\"admin-list-empty\">目前沒有人在略過名單裡</p>";

      skipListEl.querySelectorAll(".admin-adventure-skip-revoke-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("確定要把這個帳號從略過名單移除嗎？移除後對方要重新集滿 3 個條件才能用。")) return;
          await callAdventureSkipAction("remove-adventure-skip", { provider: btn.dataset.provider, id: btn.dataset.id });
        });
      });
    }
  }
  if (!card) return;
  if (!data.isSuperAdmin || !data.admins) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");

  const listEl = el("adminList");
  if (listEl) {
    const superRows = data.admins.superAdmins
      .map((key) => `<div class="admin-list-row"><span>👑 ${key}</span><span class="admin-list-tag">超級管理員・不可移除</span></div>`)
      .join("");
    const dynamicRows = data.admins.dynamicAdmins
      .map(
        (a) =>
          `<div class="admin-list-row">
            <span>🛡️ ${a.name}（${a.key}）</span>
            <button class="admin-revoke-btn" data-provider="${a.provider}" data-id="${a.id}" type="button">踢除</button>
          </div>`
      )
      .join("");
    listEl.innerHTML = superRows + dynamicRows || "<p class=\"admin-list-empty\">目前沒有管理員</p>";

    listEl.querySelectorAll(".admin-revoke-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(`確定要把這個帳號的管理員資格拿掉嗎？`)) return;
        await callAdminAction("revoke", { provider: btn.dataset.provider, id: btn.dataset.id });
      });
    });
  }
}

async function callAdminAction(action, body) {
  const msgEl = el("adminAssignMsg");
  try {
    const resp = await fetch(`/api/weather/status?admin=1&action=${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      if (msgEl) msgEl.textContent = `失敗：${data.reason || "未知錯誤"}`;
      return;
    }
    if (msgEl) msgEl.textContent = action === "assign" ? "指派成功" : "已踢除";
    adminStatusLoaded = false; // 名單變了，下次要重新載入
    loadAdminStatus();
  } catch (e) {
    if (msgEl) msgEl.textContent = "失敗：網路錯誤";
  }
}

async function callBetaAction(action, body) {
  const msgEl = el("adminBetaAssignMsg");
  try {
    const resp = await fetch(`/api/weather/status?admin=1&action=${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      if (msgEl) msgEl.textContent = `失敗：${data.reason || "未知錯誤"}`;
      return;
    }
    if (msgEl) msgEl.textContent = action === "add-beta-tester" ? "已加入名單" : "已移除";
    adminStatusLoaded = false; // 名單變了，下次要重新載入
    loadAdminStatus();
  } catch (e) {
    if (msgEl) msgEl.textContent = "失敗：網路錯誤";
  }
}

async function callAdventureSkipAction(action, body) {
  const msgEl = el("adminAdventureSkipAssignMsg");
  try {
    const resp = await fetch(`/api/weather/status?admin=1&action=${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      if (msgEl) msgEl.textContent = `失敗：${data.reason || "未知錯誤"}`;
      return;
    }
    if (msgEl) msgEl.textContent = action === "add-adventure-skip" ? "已加入名單" : "已移除";
    adminStatusLoaded = false; // 名單變了，下次要重新載入
    loadAdminStatus();
  } catch (e) {
    if (msgEl) msgEl.textContent = "失敗：網路錯誤";
  }
}

const adminAssignForm = el("adminAssignForm");
if (adminAssignForm) {
  adminAssignForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const midInput = el("adminAssignMid");
    const memberId = midInput.value.trim();
    if (!memberId) return;
    await callAdminAction("assign", { memberId });
    midInput.value = "";
  });
}

const adminBetaAssignForm = el("adminBetaAssignForm");
if (adminBetaAssignForm) {
  adminBetaAssignForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const midInput = el("adminBetaAssignMid");
    const memberId = midInput.value.trim();
    if (!memberId) return;
    await callBetaAction("add-beta-tester", { memberId });
    midInput.value = "";
  });
}

const adminAdventureSkipAssignForm = el("adminAdventureSkipAssignForm");
if (adminAdventureSkipAssignForm) {
  adminAdventureSkipAssignForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const midInput = el("adminAdventureSkipAssignMid");
    const memberId = midInput.value.trim();
    if (!memberId) return;
    await callAdventureSkipAction("add-adventure-skip", { memberId });
    midInput.value = "";
  });
}

// 暱稱修改冷卻天數：任何管理員都能改（不用到超級管理員）
const adminCooldownForm = el("adminCooldownForm");
if (adminCooldownForm) {
  adminCooldownForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = el("adminCooldownInput");
    const msgEl = el("adminCooldownMsg");
    const days = Number(input.value);
    if (!Number.isFinite(days) || days < 0) {
      if (msgEl) msgEl.textContent = "請輸入 0 以上的整數";
      return;
    }
    try {
      const resp = await fetch("/api/weather/status?admin=1&action=set-nickname-cooldown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        if (msgEl) msgEl.textContent = `失敗：${data.reason || "未知錯誤"}`;
        return;
      }
      if (msgEl) msgEl.textContent = `已更新為 ${data.nicknameCooldownDays} 天`;
    } catch (e) {
      if (msgEl) msgEl.textContent = "失敗：網路錯誤";
    }
  });
}

// 維護模式開關：任何管理員都能切（不用到超級管理員）
const adminMaintenanceToggle = el("adminMaintenanceToggle");
if (adminMaintenanceToggle) {
  adminMaintenanceToggle.addEventListener("change", async () => {
    const label = el("adminMaintenanceToggleLabel");
    const msgEl = el("adminMaintenanceMsg");
    const enabled = adminMaintenanceToggle.checked;
    adminMaintenanceToggle.disabled = true;
    if (msgEl) msgEl.textContent = "更新中…";
    try {
      const resp = await fetch("/api/weather/status?admin=1&action=set-maintenance-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        adminMaintenanceToggle.checked = !enabled; // 失敗就退回原本的狀態
        if (msgEl) msgEl.textContent = `失敗：${data.reason || "未知錯誤"}`;
        return;
      }
      if (label) label.textContent = `目前：${data.maintenanceMode ? "開啟" : "關閉"}`;
      if (msgEl) msgEl.textContent = data.maintenanceMode ? "已開啟，非管理員現在都會看到維護畫面。" : "已關閉，恢復正常使用。";
    } catch (e) {
      adminMaintenanceToggle.checked = !enabled;
      if (msgEl) msgEl.textContent = "失敗：網路錯誤";
    } finally {
      adminMaintenanceToggle.disabled = false;
    }
  });
}

// 每分鐘重新算一次倒數剩餘時間，不用手動重新整理頁面。
// sunTimesCache 已經在記憶體裡了，這裡只是重新跑一次算式更新畫面文字，不會再打 API。
setInterval(() => {
  if (currentCity && currentCity.label) {
    loadSunTimes(currentCity.label);
  }
}, 60 * 1000);

// ---------------- 即時風速（蒲氏風級）----------------
// 跟日出／月出資料同樣邏輯：整批全臺縣市資料一次撈回來，快取在同一次網頁
// 工作階段內，切換城市只要重新查表，不用每次都重打 API。
let windObsCache = null;
async function loadWindObservation(label) {
  const valueEl = el("statWind");
  const humidityEl = el("humidityValue");
  const feelsLikeEl = el("statFeelsLike");
  if (!valueEl && !humidityEl && !feelsLikeEl) return;
  try {
    if (!windObsCache) {
      const result = await window.weatherAPI.getWindObservation();
      if (!result || !result.ok) return; // 拿不到就維持「暫無資料」，不影響其他功能
      windObsCache = result.counties || {};
    }
    const wind = windObsCache[label];
    if (!wind) return;
    if (valueEl && wind.beaufortLevel !== null && wind.beaufortLevel !== undefined) {
      valueEl.textContent = `${wind.beaufortLevel} 級（${wind.beaufortDesc}）`;
      valueEl.title = `${wind.stationName} 測站　風速 ${wind.windSpeed} m/s`;
      valueEl.classList.remove("current-stat-empty");
    }
    if (humidityEl && wind.relativeHumidity !== null && wind.relativeHumidity !== undefined) {
      humidityEl.textContent = `${wind.relativeHumidity}%`;
      humidityEl.classList.remove("current-stat-empty");
    }
    if (feelsLikeEl && wind.apparentTemperature !== null && wind.apparentTemperature !== undefined) {
      feelsLikeEl.textContent = `${wind.apparentTemperature}°C`;
      feelsLikeEl.classList.remove("current-stat-empty");
    }
  } catch (e) {
    /* 拿不到就維持「暫無資料」，不影響其他功能 */
  }
}

// ---------------- 紫外線指數 ----------------
// 即時紫外線（氣象署 O-A0003-001，每 10 分鐘更新）：整批全臺縣市資料一次撈回來，
// 但只快取 10 分鐘，過了會重新撈，不會整個網頁工作階段都停在同一個數字。
let uvIndexCache = null;
let uvIndexCacheAt = 0;
const UV_INDEX_REFRESH_MS = 10 * 60 * 1000;
async function loadUvIndex(label) {
  const valueEl = el("uvIndexValue");
  if (!valueEl) return;
  try {
    if (!uvIndexCache || Date.now() - uvIndexCacheAt > UV_INDEX_REFRESH_MS) {
      const result = await window.weatherAPI.getUvIndex();
      if (!result || !result.ok) return; // 拿不到就維持「暫無資料」，不影響其他功能
      uvIndexCache = result.counties || {};
      uvIndexCacheAt = Date.now();
    }
    const uv = uvIndexCache[label];
    if (!uv || uv.uvIndex === undefined || uv.uvIndex === null) return;
    valueEl.textContent = `${uv.uvIndex}（${uv.level}）`;
    // 這個縣市自己沒有即時紫外線時，是借用最近測站的數值：滑鼠移上去會說明來源。
    valueEl.title = uv.nearest
      ? `此縣市沒有即時紫外線測站，取自最近的測站：${uv.stationName}（${uv.fromCounty}），約 ${uv.distanceKm} 公里`
      : (uv.stationName ? `${uv.stationName}測站` : "");
    valueEl.style.color = uvIndexGradientColor(uv.uvIndex);
    valueEl.classList.remove("current-stat-empty");
  } catch (e) {
    /* 拿不到就維持「暫無資料」，不影響其他功能 */
  }
}

// UV 指數數字顏色：依數值平滑漸層（不是分段跳色），最低綠色、最高紫色，
// 中間依序過黃、橙、紅，對應 WHO 的紫外線等級分類。
function uvIndexGradientColor(uv) {
  const stops = [
    { v: 0, c: [46, 204, 113] }, // 綠：低量
    { v: 3, c: [241, 196, 15] }, // 黃：中量
    { v: 6, c: [230, 126, 34] }, // 橙：高量
    { v: 8, c: [231, 76, 60] }, // 紅：過量
    { v: 11, c: [142, 68, 173] }, // 紫：危險
  ];
  const value = Math.max(0, Math.min(11, uv));
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (value >= stops[i].v && value <= stops[i + 1].v) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }
  const range = upper.v - lower.v || 1;
  const t = (value - lower.v) / range;
  const mix = (a, b) => Math.round(a + (b - a) * t);
  const [r, g, b] = [mix(lower.c[0], upper.c[0]), mix(lower.c[1], upper.c[1]), mix(lower.c[2], upper.c[2])];
  return `rgb(${r}, ${g}, ${b})`;
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

  el("currentIcon").innerHTML = iconForWx(wxNow, isNightTime(wx.time[0].startTime));
  lastWeatherSnapshot = { temp: `${minNow}~${maxNow}°C`, wx: wxNow, startTime: wx.time[0].startTime };
  sendToDynamicIsland(); // 動態島已經開著的話，資料更新（每次選城市、每 5 分鐘）就跟著更新
  advNoteWeather(wxNow); // 動態島冒險：解鎖條件「遇到晴時多雲／遇到下雨」的偵測點
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
      <div class="ficon">${iconForWx(wxText, isNightTime(wx.time[i].startTime))}</div>
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

    const wxStartNow = wx && wx.time && wx.time[0] ? wx.time[0].startTime : null;

    card.innerHTML = `
      <div class="ccity">${label}</div>
      <div class="cicon">${iconForWx(wxNow, isNightTime(wxStartNow))}</div>
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
  // 現在真的有「未來 7 天」分頁了，直接切過去，不用再捲動充數。
  const btn = document.querySelector('.tab-btn[data-tab="weekly"]');
  if (btn) btn.click();
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
      weekly: "weeklyPanel",
      chart: "chartPanel",
      compare: "comparePanel",
      map: "mapPanel",
      alerts: "alertsPanel",
      typhoon: "typhoonPanel",
      tools: "toolsPanel",
      admin: "adminPanel",
      settings: "settingsPanel",
    };
    const target = panelMap[btn.dataset.tab] || "forecastPanel";
    el(target).classList.add("active");
    if (btn.dataset.tab !== "alerts") tyRestoreMapHome(); // 颱風地圖借放在警特報卡片裡，離開就還給「颱風」分頁
    // 「工具」「設定」「後台管理」都跟城市無關，共用的頁首（城市名稱 + 加入
    // 收藏）不應該留在這幾個畫面上
    const hideHeaderTabs = ["tools", "settings", "admin"];
    const mainHeader = document.querySelector(".main-header");
    if (mainHeader) mainHeader.classList.toggle("hidden", hideHeaderTabs.includes(btn.dataset.tab));
    if (btn.dataset.tab === "compare") {
      renderCompareView(Array.from(selectedCompare));
    }
    if (btn.dataset.tab === "weekly" && currentCity && currentCity.label) {
      loadWeeklyForecast(currentCity.label);
    }
    if (btn.dataset.tab === "admin") {
      loadAdminStatus();
    }
    if (btn.dataset.tab === "alerts") {
      loadAlerts();
      loadTyphoonProbability();
    }
    if (btn.dataset.tab === "typhoon") {
      loadAlerts();
      loadTyphoonProbability();
    }
    const bottomMap = { forecast: "home", typhoon: "typhoon", alerts: "typhoon", admin: "admin", settings: "settings" };
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
  // 小視窗比地圖區塊還寬（很窄的手機）時，貼齊左邊，不要從點擊位置往右伸出去
  left = maxLeft >= 0 ? Math.min(left, maxLeft) : 4;
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

// ---- 海上颱風警報線：畫在台灣「外側」、而且畫在對應的海域方向 ----
// 做法有兩個：
//  1) 把沿海那組黃線（.alert-sea-outline／-casing）搬到陸地色塊「下面」（見 tyBuildSeaLayer）。
//     陸地色塊是不透明的，所以線只會露出外側那一半，看起來就是在台灣外面圍了一條螢光線。
//  2) 依警報的海域名稱，只留下該海域方向的那一段（見 tyApplySeaRegions）：北部海面只畫在
//     北部海岸、東部海面只畫在東部海岸…。做法是用 SVG clipPath 裁出對應的矩形範圍，
//     座標是這張地圖的座標（viewBox 原本 185 0 660 1145，本島北端 y≈0、南端 y≈1145）。
//     這些範圍是依海域地理位置人工估的，只供視覺參考，實際警戒範圍以氣象署文字為準；
//     遇到不認得的海域名稱就不裁切（退回原本「整個沿海縣市」的畫法）。
const TY_SEA_REGIONS = {
  // 北部海面：北部與西北部海岸（基隆～桃園～新竹）。分成兩塊，避開宜蘭縣北端海岸（那段屬於東北部海面）。
  北部海面: [[420, -100, 770, 110], [420, 110, 600, 185]],
  東北部海面: [[690, -100, 900, 345]],
  東部海面: [[620, 300, 900, 730]],
  東南部海面: [[430, 680, 900, 1260]],
  南部海面: [[240, 880, 560, 1260]],
  西南部海面: [[100, 610, 370, 980]],
  西部海面: [[100, 230, 440, 700]],
  海峽: [[100, -100, 520, 980]],
  海峽北部: [[100, -100, 560, 430]],
  海峽南部: [[100, 400, 390, 980]],
  巴士海峽: [[300, 1000, 900, 1260]],
  南海北部: [[100, 860, 520, 1260]],
  附近海面: [[-1000, -1000, 3000, 3000]],
  及其附近海面: [[-1000, -1000, 3000, 3000]],
};
let typhoonSeaClipEl = null;

function tySeaRegionFor(areaName) {
  const key = String(areaName || "").trim().replace(/^台/, "臺").replace(/^臺灣/, "");
  return TY_SEA_REGIONS[key] || null;
}

function tyBuildSeaLayer(svg, isMainMap) {
  const towns = svg.querySelector("#towns");
  if (!towns || !towns.parentNode) return;
  const NS = "http://www.w3.org/2000/svg";
  const layer = document.createElementNS(NS, "g");
  layer.setAttribute("class", "ty-sea-layer");
  svg.querySelectorAll(".alert-sea-outline-casing").forEach((p) => layer.appendChild(p));
  svg.querySelectorAll(".alert-sea-outline").forEach((p) => layer.appendChild(p));
  towns.parentNode.insertBefore(layer, towns); // 放在陸地色塊下面：只露出外側那一半

  if (isMainMap) {
    // 線畫在海岸外側，viewBox 要往外多留一圈，不然台灣最北／最南端的線會被切掉。
    svg.setAttribute("viewBox", "150 -45 730 1235");
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS(NS, "defs");
      svg.insertBefore(defs, svg.firstChild);
    }
    const clip = document.createElementNS(NS, "clipPath");
    clip.setAttribute("id", "tySeaClip");
    defs.appendChild(clip);
    typhoonSeaClipEl = clip;
  }
}

// 依目前生效中的海上颱風警報海域名稱，決定本島那組黃線要留下哪幾段
function tyApplySeaRegions(areaNames) {
  const layer = document.querySelector("#typhoonMapHolder .ty-sea-layer");
  if (!layer || !typhoonSeaClipEl) return;
  const rects = [];
  let allKnown = areaNames.length > 0;
  for (const name of areaNames) {
    const regions = tySeaRegionFor(name);
    if (!regions) {
      allKnown = false;
      break;
    }
    rects.push(...regions);
  }
  if (!allKnown || !rects.length) {
    layer.removeAttribute("clip-path"); // 有不認得的海域：不裁切，維持整個沿海縣市
    return;
  }
  const NS = "http://www.w3.org/2000/svg";
  while (typhoonSeaClipEl.firstChild) typhoonSeaClipEl.removeChild(typhoonSeaClipEl.firstChild);
  for (const [x0, y0, x1, y1] of rects) {
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", String(x0));
    rect.setAttribute("y", String(y0));
    rect.setAttribute("width", String(x1 - x0));
    rect.setAttribute("height", String(y1 - y0));
    typhoonSeaClipEl.appendChild(rect);
  }
  layer.setAttribute("clip-path", "url(#tySeaClip)");
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

    tyBuildSeaLayer(clone, templateId === "twZoneMapTemplate");
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
      `<div class="alert-map-legend-item"><span class="alert-map-legend-swatch alert-map-legend-swatch--line" style="background:${TYPHOON_SEA_COLOR}"></span><span>海上颱風警報（畫在台灣外側對應的海域方向，僅供參考）</span></div>`
    );
  }
  legend.innerHTML = items.join("");

  // 本島那組海上警報線只留下對應海域方向的那一段（北部海面畫在北部海岸…）
  const seaAreaNames = new Set();
  seaAreasByCounty.forEach((set) => set.forEach((n) => seaAreaNames.add(n)));
  tyApplySeaRegions(Array.from(seaAreaNames));
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
  item.dataset.rain = "1"; // 給颱風畫面的「大雨（豪雨）特報」按鈕找得到
  const barColor = alert.color || RAIN_LEVEL_FALLBACK_COLOR[alert.severityLevel] || "#7f8c9a";
  item.style.setProperty("--alert-color", barColor);

  item.innerHTML = `
    <div class="alert-row">
      <span class="alert-row-dot"></span>
      <span class="alert-row-title">${alert.alertTitle || "大雨(豪雨)特報"}</span>
      <span class="alert-row-status">${alert.isActive ? "生效中" : "已解除"}</span>
      <button class="alert-detail-btn" type="button">詳細資訊</button>
    </div>
  `;
  // 不在列表裡原地展開了：點「詳細資訊」開獨立的全螢幕大雨（豪雨）特報頁面
  item.querySelector(".alert-detail-btn").addEventListener("click", () => rainOpen(false));
  return item;
}

function renderAlertCard(alert) {
  if (alert.source === "rain") return renderRainAlertCard(alert);
  if (alert.source === "typhoon") return renderTyphoonAlertCard(alert);

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

// ---------------- 警特報分頁裡的颱風警報卡片（精簡版 + 台灣地圖）----------------
// 以前展開後會把氣象署整段電文原封不動貼出來，很長。現在只留重點（強度／名稱／中心位置／
// 風力／暴風半徑／移動），下面接台灣地圖（陸上警報縣市塗紅、海上警報在台灣外側畫螢光線），
// 完整電文收在最下面的「完整警報文字」裡，需要才點開。

function tyShortTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p2 = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

// 「11 日 17 時的中心位置在北緯 20.7 度，東經 123.9 度，即在臺東的東南方約 360 公里之海面上」
// → 「臺東東南方約 360 公里海面上」
function tyShortPlace(pos) {
  if (!pos) return null;
  const i = pos.indexOf("即在");
  const t = (i >= 0 ? pos.slice(i + 2) : pos).replace(/的/g, "").replace(/之/g, "").trim();
  return t || pos;
}

function tyCompactRows(w) {
  const rows = [];
  const place = tyShortPlace(w.facts.position);
  if (place) rows.push(["中心位置", place]);
  const wind = (w.facts.maxWind || "").match(/每秒\s*(\d+)\s*公尺.*?相當於\s*(\d+)\s*級/);
  const gust = (w.facts.gust || "").match(/相當於\s*(\d+)\s*級/);
  if (wind) rows.push(["風力", `${wind[2]} 級（每秒 ${wind[1]} 公尺）` + (gust ? `　陣風 ${gust[1]} 級` : "")]);
  else if (w.facts.maxWind) rows.push(["風力", w.facts.maxWind]);
  const radius = Array.from((w.facts.radius || "").matchAll(/(\d+)\s*級風暴風半徑\s*(\d+)\s*公里/g)).map(
    (m) => `${m[1]} 級 ${m[2]} 公里`
  );
  if (radius.length) rows.push(["暴風半徑", radius.join("　")]);
  const move = (w.facts.motion || "").match(/每小時\s*(\d+)\s*公里.*?向(.+?)進行/);
  if (move) rows.push(["移動", `向${move[2]}　時速 ${move[1]} 公里`]);
  return rows;
}

function renderTyphoonAlertCard(alert) {
  const w = parseTyphoonWarning(alert);
  const item = document.createElement("div");
  item.className = "alert-item" + (alert.isActive ? "" : " alert-item-cancelled");
  item.dataset.ty = "1";
  item.style.setProperty("--alert-color", alert.color || (w.land ? "rgb(255,0,0)" : "rgb(255,128,0)"));

  const row = tyEl("div", "alert-row");
  row.appendChild(tyEl("span", "alert-row-dot"));
  row.appendChild(tyEl("span", "alert-row-title", alert.alertTitle || alert.headline || "颱風警報"));
  row.appendChild(tyEl("span", "alert-row-status", alert.isActive ? "生效中" : "已解除"));
  const btn = tyEl("button", "alert-detail-btn", "詳細資訊");
  btn.type = "button";
  // 不在列表裡原地展開了：點下去直接開全螢幕的颱風警報畫面（跟首頁那張一樣，
  // 底下的導覽列還在），範圍地圖接在卡片下面。
  btn.addEventListener("click", () => tyOpenFromAlerts());
  row.appendChild(btn);
  item.appendChild(row);
  return item;
}

// 颱風地圖本來在「颱風」分頁裡；從警特報分頁打開全螢幕颱風畫面時，把整個地圖區塊搬進畫面裡，
// 關掉或離開警特報分頁就搬回去（地圖裡所有東西都是用 id 找的，搬動不影響原本的功能）。
function tyPlaceMapInOverlay(slot) {
  const section = el("typhoonMapSection");
  if (!slot || !section) return;
  buildTyphoonMap();
  slot.appendChild(section);
}
function tyRestoreMapHome() {
  const home = el("typhoonPanel");
  const section = el("typhoonMapSection");
  if (home && section && section.parentElement !== home) home.insertBefore(section, home.firstChild);
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
  const bottomNavWarningBtn = document.querySelector('.bottom-nav-btn[data-bottom="typhoon"]');
  // 頂部導覽列的「警特報」分頁、工具選單裡的「警特報」項目：有生效中的警特報才出現。
  const alertsTabBtn = document.querySelector('.tabs .tab-btn[data-tab="alerts"]');
  const toolsAlertItem = document.querySelector('.tools-menu-item[data-tab="alerts"]');
  [alertsTabBtn, toolsAlertItem].forEach((node) => {
    if (node) node.classList.toggle("hidden", activeCount === 0);
  });
  // 使用者當下正停在警特報分頁、警特報卻剛好解除：切回首頁，不要停在入口已經消失的分頁。
  if (activeCount === 0) {
    const alertsPanel = el("alertsPanel");
    if (alertsPanel && alertsPanel.classList.contains("active")) {
      const homeBtn = document.querySelector('.tab-btn[data-tab="forecast"]');
      if (homeBtn) homeBtn.click();
    }
  }

  if (activeCount > 0) {
    badge.textContent = String(activeCount);
    badge.classList.remove("hidden");
    if (toolsBadge) {
      toolsBadge.textContent = String(activeCount);
      toolsBadge.classList.remove("hidden");
    }
    banner.classList.remove("hidden");
    bannerText.textContent = `目前有 ${activeCount} 則警特報生效中`;
    if (bottomNavWarningBtn) bottomNavWarningBtn.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
    if (toolsBadge) toolsBadge.classList.add("hidden");
    banner.classList.add("hidden");
    // 沒有生效中的警特報就把底部導覽列這顆按鈕藏起來；如果使用者當下正好
    // 停在警特報/颱風分頁，先切回首頁，不要留在一個已經被藏起來入口的分頁。
    if (bottomNavWarningBtn) {
      bottomNavWarningBtn.classList.add("hidden");
      if (bottomNavWarningBtn.classList.contains("active") && window.activateBottomNavKey) {
        window.activateBottomNavKey("home");
      }
    }
  }
}

// ---------------- 颱風警報畫面（蓋在首頁）＋ 收合成卡片 ----------------
// 有生效中的颱風警報時：
//   * 第一次（或警報從「海上」升級成「海上陸上」、或出現新的颱風）會用全螢幕畫面蓋在首頁上，
//     顯示強度、名稱、警報種類、中心位置、風速、暴風半徑、警戒區域等詳細資料。
//   * 按「收合」就縮成首頁最上方的一條卡片：「強度颱風　警報種類　颱風名稱」，點卡片可再展開。
//   * 使用者收合過的警報會記在 localStorage，之後每 5 分鐘更新資料不會再自動彈出來。
// 資料來源是氣象署颱風警報 CAP（W-C0034-001），欄位格式見 CAP 說明文件：
//   headline／severityLevel＝「海上颱風警報」或「海上陸上颱風警報」；
//   description 內有「颱風強度及命名：輕度颱風，國際命名：TEST，中文譯名：測試。」等段落。
const TY_ACK_KEY = "mapsky_ty_ack";
const TY_INTENSITY_RANK = { 強烈: 0, 中度: 1, 輕度: 2 };
const TY_COLORS = {
  sea: { a: "#e8720c", b: "#8a3a05" }, // 海上颱風警報：橙
  both: { a: "#dc2626", b: "#6f0c0c" }, // 海上陸上／陸上颱風警報：紅
};
let tyWarnings = [];
let tyExpanded = false;

function tyEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

// 從 description 抓「標籤：內容。」這種段落；內容到第一個「。」為止（內容裡的逗號不算結束）
function tyField(desc, label) {
  const m = desc.match(new RegExp(label + "[:：]\\s*([^。]+)(?:。|$)"));
  return m ? m[1].trim() : null;
}

function parseTyphoonWarning(a) {
  // CAP 文字裡有斷行：中文與中文之間的換行／空白直接拿掉（「向西北\n進行」→「向西北進行」），
  // 數字旁邊的空白（「北緯 20.7 度」）保留。
  const CJK = "\\u4e00-\\u9fff，。、；：（）「」";
  const desc = String(a.description || "")
    .replace(new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, "g"), "$1")
    .replace(/\s+/g, " ")
    .trim();
  const naming = tyField(desc, "颱風強度及命名") || "";
  const intensityM = naming.match(/(輕度|中度|強烈)颱風/);
  const cnM = naming.match(/中文譯名[:：]\s*([^，,。\s]+)/);
  const intlM = naming.match(/國際命名[:：]\s*([^，,。]+)/);
  const numberM = desc.match(/颱風編號[:：]\s*(\d+)/);
  const reportM = desc.match(/警報報數[:：]\s*(\d+)/);

  // 警報種類：看 headline／警戒程度；都沒有寫時，退回用警戒區域判斷
  const label = `${a.headline || ""} ${a.severityLevel || ""} ${a.alertTitle || ""}`;
  let sea = label.includes("海上");
  let land = label.includes("陸上");
  if (!sea && !land) {
    land = (a.landCounties || []).length > 0;
    sea = !land;
  }

  const areas = a.areas || [];
  const name = cnM ? cnM[1] : intlM ? intlM[1].trim() : "颱風";
  return {
    key: (numberM && numberM[1]) || name,
    number: numberM ? numberM[1] : null,
    reportNo: reportM ? reportM[1] : null,
    name,
    intlName: intlM ? intlM[1].trim() : null,
    intensity: intensityM ? intensityM[1] : null,
    sea,
    land,
    sent: a.sent || null,
    expires: a.expires || null,
    simulated: Boolean(a.simulated),
    facts: {
      position: tyField(desc, "中心位置"),
      motion: tyField(desc, "預測速度及方向"),
      maxWind: tyField(desc, "近中心最大風速"),
      gust: tyField(desc, "瞬間之最大陣風"),
      pressure: tyField(desc, "中心氣壓"),
      radius: tyField(desc, "暴風半徑"),
      forecast: tyField(desc, "預測位置"),
    },
    seaAreas: areas.filter((n) => /海/.test(n)),
    landAreas: areas.filter((n) => !/海/.test(n)),
  };
}

function tyType(w) {
  return w.sea && w.land ? "海上陸上颱風警報" : w.land ? "陸上颱風警報" : "海上颱風警報";
}
function tyPalette(w) {
  return w.land ? TY_COLORS.both : TY_COLORS.sea;
}
function tyAckKey(w) {
  return `${w.key}|${tyType(w)}`;
}

// 從警特報資料整理出「目前有效的颱風警報」，一個颱風一筆（同一個颱風有多筆時取最新、種類合併）
function collectTyphoonWarnings(alerts) {
  const GRACE_MS = 30 * 60 * 1000; // 氣象署警報 4 小時到期、通常 1～3 小時更新一次，多給 30 分鐘容錯
  const byKey = new Map();
  for (const a of alerts || []) {
    if (a.source !== "typhoon" || !a.isActive) continue;
    if (/解除/.test(`${a.headline || ""} ${a.alertTitle || ""}`)) continue;
    if (a.expires && Date.parse(a.expires) + GRACE_MS < Date.now()) continue;
    const w = parseTyphoonWarning(a);
    const prev = byKey.get(w.key);
    if (!prev) {
      byKey.set(w.key, w);
      continue;
    }
    const newer = (w.sent || "") >= (prev.sent || "") ? w : prev;
    const older = newer === w ? prev : w;
    newer.sea = newer.sea || older.sea;
    newer.land = newer.land || older.land;
    newer.seaAreas = Array.from(new Set([...newer.seaAreas, ...older.seaAreas]));
    newer.landAreas = Array.from(new Set([...newer.landAreas, ...older.landAreas]));
    for (const k of Object.keys(older.facts)) if (!newer.facts[k]) newer.facts[k] = older.facts[k];
    if (!newer.intensity) newer.intensity = older.intensity;
    newer.simulated = newer.simulated && older.simulated;
    byKey.set(w.key, newer);
  }
  // 嚴重的排前面：海上陸上優先，其次強烈 > 中度 > 輕度
  return Array.from(byKey.values()).sort((x, y) => {
    if (x.land !== y.land) return x.land ? -1 : 1;
    const rx = x.intensity in TY_INTENSITY_RANK ? TY_INTENSITY_RANK[x.intensity] : 9;
    const ry = y.intensity in TY_INTENSITY_RANK ? TY_INTENSITY_RANK[y.intensity] : 9;
    return rx - ry;
  });
}

function tyLoadAck() {
  try {
    const v = JSON.parse(localStorage.getItem(TY_ACK_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}
function tySaveAck(list) {
  try {
    localStorage.setItem(TY_ACK_KEY, JSON.stringify(list));
  } catch (e) {
    /* 存不了就算了，頂多下次更新又彈出來 */
  }
}

function tyBuildCard(w) {
  const pal = tyPalette(w);
  const card = tyEl("section", "ty-card");
  card.style.setProperty("--ty-a", pal.a);
  card.style.setProperty("--ty-b", pal.b);

  const head = tyEl("div", "ty-card-head");
  if (w.simulated) head.appendChild(tyEl("div", "ty-sim-tag", "模擬測試　只有你這台裝置看得到"));
  head.appendChild(tyEl("div", "ty-type", tyType(w)));
  const nameRow = tyEl("div", "ty-name-row");
  nameRow.appendChild(tyEl("span", "ty-intensity", `${w.intensity || ""}颱風`));
  nameRow.appendChild(tyEl("span", "ty-name", w.name));
  head.appendChild(nameRow);
  const metaParts = [];
  if (w.intlName) metaParts.push(w.intlName);
  if (w.number) metaParts.push(`颱風編號 ${w.number}`);
  if (w.reportNo) metaParts.push(`第 ${w.reportNo} 報`);
  if (metaParts.length) head.appendChild(tyEl("div", "ty-meta", metaParts.join("　")));
  head.appendChild(tyEl("div", "ty-meta", `發布 ${formatAlertTime(w.sent)}　有效至 ${formatAlertTime(w.expires)}`));
  card.appendChild(head);

  const rows = [
    ["中心位置", w.facts.position, true],
    ["移動", w.facts.motion, true],
    ["近中心最大風速", w.facts.maxWind, false],
    ["瞬間最大陣風", w.facts.gust, false],
    ["中心氣壓", w.facts.pressure, false],
    ["暴風半徑", w.facts.radius, false],
    ["預測位置", w.facts.forecast, true],
  ].filter((x) => x[1]);
  if (rows.length) {
    const grid = tyEl("div", "ty-facts");
    for (const [label, value, wide] of rows) {
      const cell = tyEl("div", "ty-fact" + (wide ? " ty-fact--wide" : ""));
      cell.appendChild(tyEl("div", "ty-fact-label", label));
      cell.appendChild(tyEl("div", "ty-fact-value", value));
      grid.appendChild(cell);
    }
    card.appendChild(grid);
  }

  if (w.landAreas.length || w.seaAreas.length) {
    const areas = tyEl("div", "ty-areas");
    const addGroup = (title, names, chipCls) => {
      if (!names.length) return;
      const g = tyEl("div", "ty-areas-group");
      g.appendChild(tyEl("div", "ty-areas-title", title));
      const chips = tyEl("div", "ty-chips");
      names.forEach((n) => chips.appendChild(tyEl("span", `ty-chip ${chipCls}`, n)));
      g.appendChild(chips);
      areas.appendChild(g);
    };
    addGroup("陸上警戒區域", w.landAreas, "ty-chip--land");
    addGroup("海上警戒區域", w.seaAreas, "ty-chip--sea");
    card.appendChild(areas);
  }
  return card;
}

// 收合後的一條卡片：「強度颱風　警報種類　颱風名稱」
function tyBuildStrip(w) {
  const pal = tyPalette(w);
  const btn = tyEl("button", "ty-strip");
  btn.type = "button";
  btn.style.setProperty("--ty-a", pal.a);
  btn.style.setProperty("--ty-b", pal.b);
  btn.setAttribute("aria-label", `${w.intensity || ""}颱風 ${tyType(w)} ${w.name}，點一下展開詳細資料`);
  const text = tyEl("span", "ty-strip-text");
  text.appendChild(tyEl("span", "ty-strip-intensity", `${w.intensity || ""}颱風`));
  text.appendChild(tyEl("span", "ty-strip-type", tyType(w)));
  text.appendChild(tyEl("span", "ty-strip-name", w.name));
  btn.appendChild(text);
  if (w.simulated) btn.appendChild(tyEl("span", "ty-strip-sim", "模擬"));
  btn.appendChild(tyEl("span", "ty-strip-more", "詳細資料 ›"));
  btn.addEventListener("click", () => tyOpen());
  return btn;
}

// 從警特報分頁的颱風那一列「詳細資訊」點進來的全螢幕畫面（tyAlertsView）：
// 跟首頁那張是同一個畫面，但不影響首頁「已收合／已展開」的狀態，
// 卡片下面多接一張範圍地圖；按「關閉」、或點底部導覽列就回到警特報列表。
let tyAlertsView = false;

function tyRender() {
  const overlay = el("tyOverlay");
  const body = el("tyOverlayBody");
  const stripList = el("tyStripList");
  if (!overlay || !body || !stripList) return;

  // 地圖可能正放在下面要被清掉的畫面裡，先搬回「颱風」分頁
  tyRestoreMapHome();

  if (!tyWarnings.length) {
    tyAlertsView = false;
    overlay.classList.remove("ty-force");
    overlay.classList.add("hidden");
    stripList.classList.add("hidden");
    body.innerHTML = "";
    stripList.innerHTML = "";
    return;
  }

  const topBtn = el("tyCollapseTopBtn");
  overlay.classList.toggle("ty-force", tyAlertsView);
  if (topBtn) topBtn.textContent = tyAlertsView ? "關閉" : "收合";

  if (tyExpanded || tyAlertsView) {
    body.innerHTML = "";
    tyWarnings.forEach((w) => body.appendChild(tyBuildCard(w)));
    if (tyAlertsView) {
      const slot = tyEl("div", "ty-overlay-map");
      body.appendChild(slot);
      tyPlaceMapInOverlay(slot);
      body.appendChild(tyBuildRainButton());
    }
    overlay.classList.remove("hidden");
    stripList.classList.add("hidden");
    stripList.innerHTML = "";
  } else {
    overlay.classList.add("hidden");
    body.innerHTML = "";
    stripList.innerHTML = "";
    tyWarnings.forEach((w) => stripList.appendChild(tyBuildStrip(w)));
    stripList.classList.remove("hidden");
  }
}

// ---------------- 大雨（豪雨）特報：獨立的全螢幕頁面 ----------------
// 版型沿用颱風警報畫面：標頭（依最高等級上色）＋特報內容＋各等級／平地山區的區域標籤，
// 下面接「大雨(豪雨)特報縣市分布圖」；底部導覽列還在，右上角「關閉」。
// 從警特報列表的「詳細資訊」、或颱風畫面最下面的「大雨（豪雨）特報」按鈕打開；
// 從颱風畫面來的，按「關閉」會回到颱風畫面（rainReturnToTyphoon）。點導覽列則直接離開。
const RAIN_PAL = {
  大雨: ["#c99a00", "#6f5200"],
  豪雨: ["#e8730c", "#8a3d00"],
  大豪雨: ["#d21a1a", "#690b0b"],
  超大豪雨: ["#8e3fd6", "#3f1470"],
};
let rainView = false;
let rainReturnToTyphoon = false;
let alertMapHome = null; // 地圖區塊原本的位置 {parent, next}，搬進頁面之後要搬回去

function rainActiveAlerts() {
  return (latestMapAlerts || []).filter((a) => a && a.source === "rain" && a.isActive);
}

// ---- 「最近縣市」的等級 ----
// currentCity.label 是目前的縣市（自動定位到最近的縣市，或使用者自己選的），名稱跟特報區域
// 名稱的開頭一樣（例如「高雄市內門區」開頭是「高雄市」）。
// 回傳這個縣市在這則特報裡的最高等級；這則特報沒有涵蓋到這個縣市就回傳 null。
const rainNormName = (s) => String(s || "").replace(/台/g, "臺");
function rainLocalLevel(a) {
  const county = rainNormName(currentCity && currentCity.label);
  if (!county) return null;
  let best = null;
  for (const areas of Object.values(a.areasByZone || {})) {
    for (const ar of areas) {
      if (!rainNormName(ar.name).startsWith(county)) continue;
      if (best === null || rainLevelRank(ar.level) < rainLevelRank(best)) best = ar.level;
    }
  }
  return best;
}

// 頁面標題：最近縣市有被列入特報 → 依該縣市自己的等級叫「豪雨特報」「大雨特報」…；
// 沒有被列入（或還沒定位）→ 維持原本的「大雨（豪雨）特報」。
// 同時有多則特報時，以最近縣市最嚴重的那個等級為準。
function rainPageTitle(alerts) {
  let best = null;
  for (const a of alerts) {
    const lv = rainLocalLevel(a);
    if (lv && (best === null || rainLevelRank(lv) < rainLevelRank(best))) best = lv;
  }
  return best ? `${best}特報` : "大雨（豪雨）特報";
}

function rainBuildCard(a) {
  const overall = a.severityLevel || a.alertTitle || "大雨";
  const local = rainLocalLevel(a); // 最近縣市在這則特報裡的等級（沒被列入是 null）
  // 大字、標頭顏色：最近縣市有被列入就用該縣市的等級（豪雨 → 橘色「豪雨特報」）；
  // 沒被列入就照全臺最高等級。
  const level = local || overall;
  const pal = RAIN_PAL[level] || RAIN_PAL["大雨"];
  const card = tyEl("section", "ty-card");
  card.style.setProperty("--ty-a", pal[0]);
  card.style.setProperty("--ty-b", pal[1]);

  const head = tyEl("div", "ty-card-head");
  head.appendChild(tyEl("div", "ty-type", local ? `${local}特報` : "大雨（豪雨）特報"));
  const nameRow = tyEl("div", "ty-name-row");
  nameRow.appendChild(tyEl("span", "ty-intensity", local ? currentCity.label : "最高等級"));
  nameRow.appendChild(tyEl("span", "ty-name", level));
  head.appendChild(nameRow);
  if (a.areaCount) head.appendChild(tyEl("div", "ty-meta", `共 ${a.areaCount} 個區域`));
  if (local && local !== overall) head.appendChild(tyEl("div", "ty-meta", `全臺最高等級　${overall}`));
  head.appendChild(tyEl("div", "ty-meta", `發布 ${formatAlertTime(a.sent)}　有效至 ${formatAlertTime(a.expires)}`));
  card.appendChild(head);

  if (a.description) {
    const grid = tyEl("div", "ty-facts");
    const cell = tyEl("div", "ty-fact ty-fact--wide");
    cell.appendChild(tyEl("div", "ty-fact-label", "特報內容"));
    const value = tyEl("div", "ty-fact-value", a.description);
    value.style.whiteSpace = "pre-line";
    cell.appendChild(value);
    grid.appendChild(cell);
    card.appendChild(grid);
  }
  return card;
}

// 受影響區域：依等級（重 → 輕）、再依平地／山區分組，每組是一個可收合的區塊（預設收起來），
// 標籤顏色跟地圖上的等級色一致。放在分布圖的下面（見 rainRender）。
// 資料每 5 分鐘會整頁重畫一次，所以「哪幾組被使用者展開」要另外記著，不然一重畫又全部收起來。
const rainFoldOpen = new Set();
function rainBuildAreas(a) {
  const groups = [];
  const byKey = new Map();
  for (const [zone, areas] of Object.entries(a.areasByZone || {})) {
    for (const ar of areas) {
      const key = `${ar.level}|${zone}`;
      if (!byKey.has(key)) {
        const g = {
          key,
          level: ar.level,
          zone,
          color: ar.color || RAIN_LEVEL_FALLBACK_COLOR[ar.level] || "#ffffff",
          names: [],
        };
        byKey.set(key, g);
        groups.push(g);
      }
      byKey.get(key).names.push(ar.name);
    }
  }
  groups.sort((x, y) => rainLevelRank(x.level) - rainLevelRank(y.level) || String(x.zone).localeCompare(String(y.zone), "zh-Hant"));
  if (!groups.length) return null;

  const wrap = tyEl("section", "rain-fold-card");
  wrap.appendChild(tyEl("div", "rain-fold-heading", a.areaCount ? `受影響區域（${a.areaCount}）` : "受影響區域"));
  for (const g of groups) {
    const det = document.createElement("details");
    det.className = "rain-fold-group";
    if (rainFoldOpen.has(g.key)) det.open = true;
    det.addEventListener("toggle", () => {
      if (det.open) rainFoldOpen.add(g.key);
      else rainFoldOpen.delete(g.key);
    });
    const sum = document.createElement("summary");
    sum.className = "rain-fold-title";
    const dot = tyEl("span", "rain-fold-dot");
    dot.style.background = g.color;
    sum.appendChild(dot);
    sum.appendChild(tyEl("span", "rain-fold-name", `${g.level}　${g.zone}`));
    sum.appendChild(tyEl("span", "rain-fold-count", `${g.names.length} 個區域`));
    det.appendChild(sum);
    const chips = tyEl("div", "ty-chips rain-fold-body");
    g.names.forEach((n) => {
      const chip = tyEl("span", "ty-chip", n);
      chip.style.cssText = rainChipStyle(g.color, g.level);
      chips.appendChild(chip);
    });
    det.appendChild(chips);
    wrap.appendChild(det);
  }
  return wrap;
}

function rainRestoreMapHome() {
  const section = el("alertMapSection");
  if (!section || !alertMapHome) return;
  const { parent, next } = alertMapHome;
  if (section.parentElement !== parent) parent.insertBefore(section, next && next.parentNode === parent ? next : null);
  section.classList.add("hidden"); // 沒展開任何特報時，地圖本來就是藏起來的
}

function rainRender() {
  const overlay = el("rainOverlay");
  const body = el("rainOverlayBody");
  if (!overlay || !body) return;
  rainRestoreMapHome(); // 地圖可能正放在下面要被清掉的頁面裡，先搬回去
  const alerts = rainActiveAlerts();
  if (!rainView || !alerts.length) {
    // 特報解除了（資料更新後沒有生效中的大雨特報），頁面自己關掉
    rainView = false;
    rainReturnToTyphoon = false;
    overlay.classList.add("hidden");
    body.innerHTML = "";
    return;
  }
  body.innerHTML = "";
  alerts.forEach((a) => body.appendChild(rainBuildCard(a)));
  const section = el("alertMapSection");
  if (section && alertMapHasData) {
    if (!alertMapHome) alertMapHome = { parent: section.parentElement, next: section.nextSibling };
    buildAlertMap();
    section.classList.remove("hidden");
    const slot = tyEl("div", "ty-overlay-map");
    body.appendChild(slot);
    slot.appendChild(section);
  }
  // 受影響區域（可收合）放在分布圖下面
  alerts.forEach((a) => {
    const areas = rainBuildAreas(a);
    if (areas) body.appendChild(areas);
  });
  // 上方標題列：最近縣市是豪雨就寫「豪雨特報」，不然維持「大雨（豪雨）特報」
  const title = rainPageTitle(alerts);
  const topTitle = overlay.querySelector(".ty-overlay-top-title");
  if (topTitle) topTitle.textContent = title;
  overlay.setAttribute("aria-label", title);
  overlay.classList.remove("hidden");
}

function rainOpen(fromTyphoon) {
  rainView = true;
  rainReturnToTyphoon = Boolean(fromTyphoon);
  rainRender();
  const overlay = el("rainOverlay");
  if (overlay) overlay.scrollTop = 0;
}

function rainClose() {
  const back = rainReturnToTyphoon;
  rainView = false;
  rainReturnToTyphoon = false;
  rainRender();
  if (back) tyOpenFromAlerts();
}

// 資料更新時（每 5 分鐘）：renderAlertMap() 會把地圖區塊藏起來，頁面開著的話要重畫一次
function rainRefresh() {
  if (rainView) rainRender();
}

el("rainCloseBtn").onclick = rainClose;
// 點底部導覽列（換分頁、或再點一次警特報）就直接離開這個頁面，不回颱風畫面
document.addEventListener(
  "click",
  (evt) => {
    if (rainView && evt.target.closest && evt.target.closest(".tab-btn, .bottom-nav-btn")) {
      rainReturnToTyphoon = false;
      rainClose();
    }
  },
  true
);

// 颱風畫面最下面的「大雨（豪雨）特報」按鈕：開大雨（豪雨）特報的獨立頁面（見下面 rainOpen）。
// 目前沒有生效中的大雨（豪雨）特報時，按鈕是灰的、不能按，但還是顯示，讓使用者知道有這個分類。
function tyActiveRainCount() {
  return (latestMapAlerts || []).filter((a) => a && a.source === "rain" && a.isActive).length;
}

function tyBuildRainButton() {
  const count = tyActiveRainCount();
  const btn = tyEl("button", "ty-rain-btn");
  btn.type = "button";
  btn.appendChild(tyEl("span", "ty-rain-btn-title", "🌧️ 大雨（豪雨）特報"));
  btn.appendChild(tyEl("span", "ty-rain-btn-sub", count ? `${count} 則生效中　查看 ›` : "目前沒有生效中的特報"));
  if (!count) {
    btn.disabled = true;
    return btn;
  }
  btn.addEventListener("click", () => {
    tyCloseAlertsView();
    rainOpen(true); // 關掉颱風畫面，開大雨（豪雨）特報頁面；那邊按「關閉」會回到這個颱風畫面
  });
  return btn;
}

function tyOpenFromAlerts() {
  tyAlertsView = true;
  tyRender();
  const overlay = el("tyOverlay");
  if (overlay) overlay.scrollTop = 0;
}

function tyCloseAlertsView() {
  if (!tyAlertsView) return;
  tyAlertsView = false;
  tyRender();
}

// 在警特報分頁開著這個畫面時，點導覽列（換分頁、或再點一次警特報）就關掉它
document.addEventListener(
  "click",
  (evt) => {
    if (tyAlertsView && evt.target.closest && evt.target.closest(".tab-btn, .bottom-nav-btn")) tyCloseAlertsView();
  },
  true
);

// ---- 所在縣市在陸上颱風警報範圍內：每次開啟 App 都強制蓋住首頁 ----
// 平常使用者「收合」過的警報，只有出現新颱風、或警報種類變了才會再自動展開（見
// renderTyphoonWarning）。但如果使用者目前的縣市（定位到的／收藏的／首頁正在看的那個）
// 就在陸上颱風警報的範圍內，這件事跟他直接相關，所以每次重新開啟 App（或離開超過一分鐘再
// 回來）都直接蓋住首頁，不管以前收合過沒有。只在剛開啟的前 90 秒內判斷（定位、警報資料
// 都是非同步載入，誰先到都要能觸發）；使用者這次已經自己收合過，就不會再蓋。
const TY_FORCE_WINDOW_MS = 90 * 1000;
const TY_REOPEN_AFTER_MS = 60 * 1000;
let tyBootAt = Date.now(); // 這次開啟（或從背景回來）的起算時間
let tyForceDone = false; // 這次開啟已經強制蓋過了
let tyUserCollapsedThisOpen = false; // 使用者這次已經自己收合過
let tyHiddenAt = 0;

function tyLocationInLandWarning() {
  if (!currentCity || !currentCity.label) return false;
  const norm = (x) => String(x).replace(/台/g, "臺");
  const here = norm(currentCity.label);
  return tyWarnings.some((w) => (w.landAreas || []).some((a) => norm(a) === here));
}

function tyMaybeForceForLocation() {
  if (tyForceDone || tyUserCollapsedThisOpen) return;
  if (Date.now() - tyBootAt > TY_FORCE_WINDOW_MS) return;
  if (!tyLocationInLandWarning()) return;
  tyForceDone = true;
  tyExpanded = true;
  tyRender();
  const overlay = el("tyOverlay");
  if (overlay) overlay.scrollTop = 0;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    tyHiddenAt = Date.now();
    return;
  }
  if (tyHiddenAt && Date.now() - tyHiddenAt >= TY_REOPEN_AFTER_MS) {
    // 離開超過一分鐘再回來，當作重新開啟
    tyBootAt = Date.now();
    tyForceDone = false;
    tyUserCollapsedThisOpen = false;
    tyMaybeForceForLocation();
  }
  tyHiddenAt = 0;
});

function tyOpen() {
  tyExpanded = true;
  tyRender();
  const overlay = el("tyOverlay");
  if (overlay) overlay.scrollTop = 0;
}

function tyCollapse() {
  tyUserCollapsedThisOpen = true;
  const ack = new Set(tyLoadAck());
  tyWarnings.forEach((w) => ack.add(tyAckKey(w)));
  tySaveAck(Array.from(ack));
  tyExpanded = false;
  tyRender();
}

function renderTyphoonWarning(alerts) {
  tyWarnings = collectTyphoonWarnings(alerts);
  if (!tyWarnings.length) {
    // 警報全部解除了：清掉「已收合」的紀錄，下一個颱風來的時候才會再自動展開
    tyExpanded = false;
    if (tyLoadAck().length) tySaveAck([]);
    tyRender();
    return;
  }
  const ack = new Set(tyLoadAck());
  // 出現新的颱風、或警報種類變了（海上 → 海上陸上）才自動展開；使用者收合過的就維持卡片
  if (tyWarnings.some((w) => !ack.has(tyAckKey(w)))) tyExpanded = true;
  tyRender();
  tyMaybeForceForLocation(); // 使用者所在縣市在陸上警報範圍內：不管收合過沒有，剛開啟時都蓋住
}

el("tyCollapseTopBtn").onclick = () => (tyAlertsView ? tyCloseAlertsView() : tyCollapse());
el("tyCollapseBtn").onclick = tyCollapse;
el("tyAllAlertsBtn").onclick = () => {
  const alertsTab = document.querySelector('.tab-btn[data-tab="alerts"]');
  if (alertsTab) alertsTab.click();
};

// ---------------- 模擬颱風警報（後台預覽用）----------------
// 只存在這台裝置（localStorage），不會送到伺服器、不會推播，其他使用者完全不受影響。
// 啟動後 loadAlerts() 會把一則「假的」颱風警報混進警特報資料裡，所以警報畫面、收合卡片、
// 警特報分頁、颱風分頁地圖都會照真的警報一樣運作；2 小時後自動結束，避免忘記關。
const TY_SIM_KEY = "mapsky_ty_sim";
const TY_SIM_MAX_MS = 2 * 60 * 60 * 1000;
const TY_SIM_NUMBER = "99";
// 各強度的示意數值（風速對照氣象署強度分級：輕度 17.2～32.6、中度 32.7～50.9、強烈 51.0 m/s 以上）
const TY_SIM_PRESETS = {
  輕度: { w: 25, wLv: 10, g: 33, gLv: 12, pressure: 980, r7: 150, r10: "－", speed: 18 },
  中度: { w: 42, wLv: 14, g: 52, gLv: 16, pressure: 950, r7: 200, r10: 60, speed: 20 },
  強烈: { w: 58, wLv: 17, g: 72, gLv: 17, pressure: 915, r7: 250, r10: 100, speed: 22 },
};

function tyLoadSim() {
  try {
    const sim = JSON.parse(localStorage.getItem(TY_SIM_KEY) || "null");
    if (!sim || !TY_SIM_PRESETS[sim.intensity]) return null;
    if (!sim.startedAt || Date.now() - sim.startedAt > TY_SIM_MAX_MS) {
      localStorage.removeItem(TY_SIM_KEY);
      return null;
    }
    return sim;
  } catch (e) {
    return null;
  }
}

function buildSimulatedTyphoonAlert(sim) {
  const p = TY_SIM_PRESETS[sim.intensity];
  const both = sim.type === "both";
  const now = new Date();
  const sent = now.toISOString();
  const expires = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();
  const day = now.getDate();
  const hour = now.getHours();
  const later = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const headline = both ? "海上陸上颱風警報" : "海上颱風警報";
  const name = sim.name || "測試";
  const kmh = (ms) => Math.round(ms * 3.6);
  const forecast = both
    ? "即在花蓮的南南東方約 40 公里之陸地上"
    : "即在花蓮的東南東方約 190 公里之海面上";
  const description =
    `警報報數:1。颱風編號:${TY_SIM_NUMBER}。` +
    `颱風強度及命名:${sim.intensity}颱風，國際命名：SIMULATION，中文譯名：${name}。` +
    `中心氣壓:${p.pressure} 百帕。` +
    `中心位置:${day} 日 ${hour} 時的中心位置在北緯 21.6 度，東經 121.9 度，即在鵝鑾鼻的南南東方約 120 公里之海面上。` +
    `暴風半徑:7 級風暴風半徑 ${p.r7} 公里，10 級風暴風半徑 ${p.r10} 公里。` +
    `預測速度及方向:以每小時 ${p.speed} 公里速度，向北北西進行。` +
    `近中心最大風速:每秒 ${p.w} 公尺(約每小時 ${kmh(p.w)} 公里)，相當於 ${p.wLv} 級風。` +
    `瞬間之最大陣風:每秒 ${p.g} 公尺(約每小時 ${kmh(p.g)} 公里)，相當於 ${p.gLv} 級風。` +
    `預測位置:${later.getDate()} 日 ${hour} 時的中心位置在北緯 23.4 度，東經 121.3 度，${forecast}。`;
  const seaAreas = ["臺灣東南部海面", "巴士海峽", "臺灣南部海面"];
  const landCounties = both ? ["屏東縣", "臺東縣", "高雄市"] : [];
  return {
    id: "SIMULATED-TYPHOON",
    source: "typhoon",
    simulated: true,
    sent,
    status: "Actual",
    msgType: "Alert",
    isActive: true,
    event: "颱風",
    effective: sent,
    onset: sent,
    expires,
    headline,
    description,
    alertTitle: "颱風警報（模擬）",
    severityLevel: headline,
    color: both ? "rgb(255,0,0)" : "rgb(255,128,0)",
    areas: [...landCounties, ...seaAreas],
    areaCount: landCounties.length + seaAreas.length,
    landCounties,
    seaCounties: ["臺東縣", "屏東縣", "高雄市"],
    seaCountyAreas: {
      臺東縣: ["臺灣東南部海面", "巴士海峽"],
      屏東縣: ["臺灣東南部海面", "巴士海峽", "臺灣南部海面"],
      高雄市: ["臺灣南部海面"],
    },
  };
}

// loadAlerts() 呼叫：模擬中就把假的颱風警報混進去（否則原樣回傳）
function withSimulatedTyphoon(alerts) {
  const sim = tyLoadSim();
  return sim ? [buildSimulatedTyphoonAlert(sim), ...(alerts || [])] : alerts || [];
}

function syncAdminTySimUi() {
  const msg = el("adminTySimMsg");
  if (!msg) return;
  const sim = tyLoadSim();
  if (!sim) {
    msg.textContent = "目前沒有在模擬。";
    return;
  }
  const left = Math.max(1, Math.round((TY_SIM_MAX_MS - (Date.now() - sim.startedAt)) / 60000));
  const typeLabel = sim.type === "both" ? "海上陸上颱風警報" : "海上颱風警報";
  msg.textContent = `模擬中：${sim.intensity}颱風　${typeLabel}　${sim.name}（約 ${left} 分鐘後自動結束）`;
  if (el("adminTySimIntensity")) el("adminTySimIntensity").value = sim.intensity;
  if (el("adminTySimType")) el("adminTySimType").value = sim.type;
  if (el("adminTySimName")) el("adminTySimName").value = sim.name;
}

if (el("adminTySimStart")) {
  el("adminTySimStart").onclick = async () => {
    const intensity = el("adminTySimIntensity").value;
    const type = el("adminTySimType").value === "both" ? "both" : "sea";
    const name = (el("adminTySimName").value || "").trim().slice(0, 8) || "測試";
    try {
      localStorage.setItem(TY_SIM_KEY, JSON.stringify({ intensity, type, name, startedAt: Date.now() }));
    } catch (e) {
      el("adminTySimMsg").textContent = "這個瀏覽器不允許儲存資料，沒辦法模擬。";
      return;
    }
    // 讓警報畫面重新彈出來（清掉這個模擬颱風之前「已收合」的紀錄）
    tySaveAck(tyLoadAck().filter((k) => !k.startsWith(`${TY_SIM_NUMBER}|`)));
    await loadAlerts();
    syncAdminTySimUi();
    const homeBtn = document.querySelector('.tab-btn[data-tab="forecast"]');
    if (homeBtn) homeBtn.click(); // 切到首頁，才看得到蓋在首頁上的警報畫面
  };
}
if (el("adminTySimStop")) {
  el("adminTySimStop").onclick = async () => {
    try {
      localStorage.removeItem(TY_SIM_KEY);
    } catch (e) {
      /* 忽略 */
    }
    await loadAlerts();
    syncAdminTySimUi();
  };
}
syncAdminTySimUi();
// ---------------- end 颱風警報畫面 ----------------

async function loadAlerts() {
  const data = await window.weatherAPI.getAlerts();
  const alerts = withSimulatedTyphoon((data && data.alerts) || []); // 後台「模擬颱風警報」啟動時會多一則假的
  const listEl = el("alertsList");
  const emptyEl = el("alertsEmpty");
  tyRestoreMapHome(); // 地圖如果正放在某張卡片裡，先搬回去，不然清掉列表時連地圖一起被清掉了
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
  renderTyphoonWarning(alerts);
  rainRefresh();
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

// 「重新整理」按鈕已經從警特報頁面拿掉（index.html 裡不再有 #refreshAlertsBtn）。
// 警特報會在切到該分頁時重新讀取，也會收到自動更新通知（onAlertsUpdated）。
// 這裡留著防空值判斷：日後要把按鈕加回來，或別的畫面沒有這顆按鈕，都不會讓整支腳本中斷。
const refreshAlertsBtn = el("refreshAlertsBtn");
if (refreshAlertsBtn) {
  refreshAlertsBtn.onclick = async () => {
    refreshAlertsBtn.disabled = true;
    try {
      await window.weatherAPI.forceRefreshAlerts();
      await loadAlerts();
      await loadTyphoonProbability();
    } finally {
      refreshAlertsBtn.disabled = false;
    }
  };
}

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
  } else if (window.mapskyLocation && window.mapskyLocation.lookup) {
    // 桌面版：先用「上次定位到的縣市」（沒有就用第一個收藏城市）秒開，
    // 同時在背景讀系統定位，讀到了再自動切到目前所在縣市，不用每次手動按「自動定位」。
    // 下拉選單也一併同步，不會停在清單第一項的臺北市。
    let last = null;
    try { last = localStorage.getItem(LAST_LOCATED_KEY); } catch (e) {}
    const first = (last && CWA_CITIES.includes(last) && last) || (favorites[0] && favorites[0].label) || null;
    if (first) {
      const sel = el("citySelect");
      if ([...sel.options].some((o) => o.value === first)) sel.value = first;
      selectCity(first);
    }
    setTimeout(autoLocateDesktop, 300);
  } else if (favorites.length > 0) {
    selectCity(favorites[0].label);
  } else {
    setTimeout(autoLocate, 300);
  }
})();

// 加到主畫面、用獨立 App 模式打開時，如果使用者還沒對定位權限表態過，
// 自動幫他跳出系統的定位權限彈窗（做法跟推播通知那邊一樣）。
// 這裡只是要觸發權限詢問，不會因此切換目前畫面顯示的縣市——
// 已經有收藏城市的人不會被打斷。跟推播的彈窗錯開一點時間，
// 避免兩個系統權限彈窗幾乎同時跳出來、使用者分不清楚在問什麼。
async function maybeAutoPromptLocation() {
  if (!navigator.geolocation) return;
  if (!(window.appInfo && window.appInfo.isStandalone)) return;
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const status = await navigator.permissions.query({ name: "geolocation" });
      if (status.state !== "prompt") return; // 已經允許過或拒絕過，不用再問
    }
  } catch {
    // 這個瀏覽器的 Permissions API 不支援查詢 geolocation 狀態，
    // 那就直接嘗試，getCurrentPosition 本身也會處理權限詢問。
  }
  navigator.geolocation.getCurrentPosition(
    () => {},
    () => {},
    { maximumAge: 60000, timeout: 15000 }
  );
}
setTimeout(maybeAutoPromptLocation, 1500);

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
// 「首頁」「颱風」「設定」都直接對應分頁按鈕；「工具」先捲動到分頁列
// 讓使用者自己挑（未來 7 天／溫度趨勢圖／多城市比較／地圖選點）。
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
  setBottomNavActive(key);
  if (key === "home") {
    document.querySelector('.tab-btn[data-tab="forecast"]').click();
    document.querySelector(".main").scrollTo({ top: 0, behavior: "smooth" });
  } else if (key === "typhoon") {
    // 先看已發佈的警特報清單，想看颱風地圖詳情的話從清單裡點進去
    document.querySelector('.tab-btn[data-tab="alerts"]').click();
  } else if (key === "tools") {
    document.querySelector('.tab-btn[data-tab="tools"]').click();
  } else if (key === "settings") {
    document.querySelector('.tab-btn[data-tab="settings"]').click();
  } else if (key === "admin") {
    document.querySelector('.tab-btn[data-tab="admin"]').click();
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
        "left 0.24s cubic-bezier(.32,2.2,.6,1), width 0.24s cubic-bezier(.32,2.2,.6,1)";
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

  // 立刻先定位一次（不要只靠 window.onload——如果這段程式執行的時候
  // load 事件早就已經觸發過，監聽器就永遠不會被呼叫到，指示器會一直是
  // opacity:0 完全看不到）。DOM 這時候已經解析完了，量測位置沒問題。
  moveTo(currentActiveKey(), false);
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

// 底部導覽列原本有「往下捲自動縮小、往上捲恢復」的效果，
// 使用者反應滑動時選單一直變動很干擾，這裡整個拿掉，改成固定大小。

document.querySelectorAll(".bottom-nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => activateBottomNavKey(btn.dataset.bottom));
});

// 工具分頁裡的每個項目，點下去就直接切去對應的分頁（這些分頁本來就存在，
// 工具分頁只是一個統整入口，不是彈出選單了）。
document.querySelectorAll(".tools-menu-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelector(`.tab-btn[data-tab="${item.dataset.tab}"]`).click();
    document.querySelector(".main").scrollTo({ top: 0, behavior: "smooth" });
  });
});

// ==================== 冒險分頁：動態島 ====================
// ---------- 動態島(Dynamic Island)天氣卡片 ----------
// 點一下按鈕開始顯示(就算把 App 從多工列滑掉，Live Activity 還是會留在
// 動態島／鎖定畫面上，這是 iOS ActivityKit 本身的特性，不需要額外處理)；
// 再點一下結束。顯示中的話，之後每次天氣資料刷新也會自動同步更新內容。
function sfSymbolForWx(text, night) {
  if (!text) return "questionmark.circle";
  if (text.includes("雷") && text.includes("雨")) return "cloud.bolt.rain.fill";
  if (text.includes("雷")) return "cloud.bolt.fill";
  if (text.includes("豪雨")) return "cloud.heavyrain.fill";
  if (text.includes("毛毛雨")) return "cloud.drizzle.fill";
  if (text.includes("雨")) return "cloud.rain.fill";
  if (text.includes("雪")) return "cloud.snow.fill";
  if (text.includes("霧")) return "cloud.fog.fill";
  if (night && text.includes("多雲") && text.includes("晴")) return "cloud.moon.fill";
  if (text.includes("多雲") && text.includes("晴")) return "cloud.sun.fill";
  if (text.includes("陰") || text.includes("多雲")) return "cloud.fill";
  if (night && text.includes("晴")) return "moon.stars.fill";
  if (text.includes("晴")) return "sun.max.fill";
  return "thermometer.medium";
}

// ---------------- 動態島冒險（設定頁裡的解鎖小遊戲）----------------
// 「動態島」功能（把天氣顯示在 iOS 動態島／鎖定畫面）要集滿 3 個條件才能使用：
//   1. 連續 3 天打開 App（用裝置本地日期算連續天數，中間斷過一天就從 1 重新算）
//   2. 遇到「晴時多雲」的天氣（不限哪個縣市，畫面上顯示過一次就算，見 advNoteWeather）
//   3. 遇到下雨的天氣（小雨／大雨／陣雨／雷陣雨…只要文字裡有「雨」都算）
// 三個全部達成一次以後就永久解鎖，之後就算連續簽到斷掉也不會重新鎖上。
// 只存在這台裝置（localStorage），不會送到伺服器，換裝置或清瀏覽器資料要重新集。
const ADV_KEY = "mapsky_adventure";

function advLoad() {
  const fallback = { streak: 0, lastCheckin: null, sawCloudy: false, sawRain: false, unlocked: false };
  try {
    const v = JSON.parse(localStorage.getItem(ADV_KEY) || "null");
    return v && typeof v === "object" ? Object.assign(fallback, v) : fallback;
  } catch (e) {
    return fallback;
  }
}
function advSave(state) {
  try {
    localStorage.setItem(ADV_KEY, JSON.stringify(state));
  } catch (e) {
    /* 存不了就算了，頂多這次沒記到，下次再判斷一次 */
  }
}
function advIsUnlocked(state) {
  // window.__mapskyAdventureSkip 是後端在登入時算好的（後台「略過名單」+ 超級管理員），
  // 見 web-shim.js 的 initAuthGate()。不受名單控制的一般使用者這個值是 false，
  // 完全不影響本來「集滿 3 個條件」的判斷。
  return state.unlocked || (state.streak >= 3 && state.sawCloudy && state.sawRain) || Boolean(window.__mapskyAdventureSkip);
}

// 每天第一次打開 App 呼叫一次：算連續簽到天數
function advCheckIn() {
  const state = advLoad();
  const today = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD（裝置本地日期）
  if (state.lastCheckin !== today) {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yesterday = y.toLocaleDateString("sv-SE");
    state.streak = state.lastCheckin === yesterday ? state.streak + 1 : 1;
    state.lastCheckin = today;
    if (advIsUnlocked(state)) state.unlocked = true;
    advSave(state);
  }
  advRenderSettingsCard(state);
}

// 每次天氣資料更新（選城市、每 5 分鐘刷新）呼叫一次：偵測有沒有遇到目標天氣
function advNoteWeather(wxText) {
  if (!wxText) return;
  const state = advLoad();
  let changed = false;
  if (!state.sawCloudy && wxText.includes("晴時多雲")) {
    state.sawCloudy = true;
    changed = true;
  }
  if (!state.sawRain && wxText.includes("雨")) {
    state.sawRain = true;
    changed = true;
  }
  if (!changed) return;
  if (advIsUnlocked(state)) state.unlocked = true;
  advSave(state);
  advRenderSettingsCard(state);
}

function advRenderSettingsCard(state) {
  state = state || advLoad();
  const unlocked = advIsUnlocked(state);

  const setCond = (id, done, progress) => {
    const li = el(id);
    if (!li) return;
    li.classList.toggle("done", done);
    const check = li.querySelector(".adv-check");
    if (check) check.textContent = done ? "✓" : "";
    const prog = li.querySelector(".adv-progress");
    if (prog) prog.textContent = progress || "";
  };
  setCond("advCondStreak", state.streak >= 3, state.streak >= 3 ? "" : `（目前連續 ${state.streak} 天）`);
  setCond("advCondCloudy", state.sawCloudy);
  setCond("advCondRain", state.sawRain);

  const panel = el("adventurePanel");
  if (panel) panel.classList.toggle("adventure-locked", !unlocked);

  // 已經解鎖之後，「連續簽到 3 天／遇到晴時多雲／遇到下雨」這些任務清單
  // 就沒有意義了（任務是拿來解鎖用的，解鎖後永遠都用得到，不會再變回鎖住），
  // 留著只是佔位置。解鎖後直接收起清單，說明文字也跟著換成不提條件的版本；
  // 還沒解鎖時維持原樣，讓使用者知道還差哪些條件。
  const conditions = el("adventureConditions");
  if (conditions) conditions.classList.toggle("hidden", unlocked);
  const desc = document.querySelector("#adventurePanel .adventure-desc");
  if (desc) {
    desc.textContent = unlocked
      ? "把天氣顯示在動態島與鎖定畫面上，不用打開 App 也能看到。"
      : "把天氣顯示在動態島與鎖定畫面上，不用打開 App 也能看到。集滿以下 3 個條件即可使用：";
  }

  updateDynamicIslandBtnUI(state);
}

const DYNAMIC_ISLAND_ON_KEY = "mapsky_dynamic_island_on";
// 只記使用者上次有沒有按開，開機時用來還原卡片顯示；動態島本身要不要接著出現，
// 還是看 sendToDynamicIsland() 真的呼叫原生端一次（LiveActivityPlugin.start()
// 自己認得上次沒關掉的 Live Activity，見 Swift 端註解）。
let dynamicIslandOn = (() => {
  try { return localStorage.getItem(DYNAMIC_ISLAND_ON_KEY) === "1"; } catch (e) { return false; }
})();
function updateDynamicIslandBtnUI(state) {
  const btn = el("dynamicIslandBtn");
  if (!btn) return;
  const unlocked = advIsUnlocked(state || advLoad());
  const status = el("adventureStatus");
  updateAdventureCardSwap(unlocked); // 解鎖前一律顯示宣傳卡；解鎖後由 dynamicIslandOn 決定顯示哪一張
  if (!unlocked) {
    btn.disabled = true;
    btn.classList.remove("active");
    btn.textContent = "🔒 尚未解鎖";
    if (status) status.textContent = "集滿上面 3 個條件，就能把天氣顯示在動態島 / 鎖定畫面";
    return;
  }
  btn.disabled = false;
  btn.textContent = dynamicIslandOn ? "結束動態島" : "動態島";
  btn.classList.toggle("active", dynamicIslandOn);
  const state2 = state || advLoad();
  const viaSkip = window.__mapskyAdventureSkip && !state2.unlocked && !(state2.streak >= 3 && state2.sawCloudy && state2.sawRain);
  if (status) {
    status.textContent = dynamicIslandOn
      ? `${currentCity ? currentCity.label + "・" : ""}動態島顯示中，把 App 滑掉也不會消失`
      : viaSkip
      ? "管理員已為你開通，不用集滿條件也能使用"
      : "點一下按鈕，把天氣顯示在動態島 / 鎖定畫面";
  }
}

async function sendToDynamicIsland() {
  if (!dynamicIslandOn || !window.MapSkyNative?.isNative || !lastWeatherSnapshot || !currentCity) return;
  await window.MapSkyNative.updateDynamicIsland({
    temperature: lastWeatherSnapshot.temp,
    condition: lastWeatherSnapshot.wx,
    conditionSymbol: sfSymbolForWx(lastWeatherSnapshot.wx, isNightTime(lastWeatherSnapshot.startTime)),
    cityName: currentCity.label,
  });
}

function updateAdventureCardSwap(unlocked) {
  const promo = el("adventurePanel");
  const enabled = el("adventureEnabledCard");
  if (!promo || !enabled) return;
  const showEnabled = unlocked && dynamicIslandOn;
  promo.classList.toggle("hidden", showEnabled);
  enabled.classList.toggle("hidden", !showEnabled);
  const sub = el("adventureEnabledSub");
  if (sub) sub.textContent = currentCity ? `${currentCity.label}．已顯示在動態島 / 鎖定畫面` : "已顯示在動態島 / 鎖定畫面";
}

advCheckIn(); // 進頁面時算一次今天的連續簽到

const dynamicIslandBtn = el("dynamicIslandBtn");
if (dynamicIslandBtn) {
  dynamicIslandBtn.addEventListener("click", async () => {
    if (!advIsUnlocked(advLoad())) return; // 按鈕本身也是 disabled，這裡多一層保險
    if (!window.MapSkyNative?.isNative) {
      setStatus("動態島功能僅支援 iOS App，網頁版無法使用");
      return;
    }
    if (!currentCity || !lastWeatherSnapshot) {
      setStatus("請先選擇城市，等天氣資料載入後再試");
      return;
    }
    dynamicIslandBtn.disabled = true;
    try {
      if (dynamicIslandOn) {
        await window.MapSkyNative.endDynamicIsland();
        dynamicIslandOn = false;
      } else {
        await sendToDynamicIsland();
        dynamicIslandOn = true;
      }
      try { localStorage.setItem(DYNAMIC_ISLAND_ON_KEY, dynamicIslandOn ? "1" : "0"); } catch (e) {}
      updateDynamicIslandBtnUI();
    } finally {
      dynamicIslandBtn.disabled = false;
    }
  });
}

// 精簡狀態卡上的「關閉」按鈕：直接轉發給上面那顆按鈕，共用同一套開關／原生呼叫邏輯，
// 不用再寫一次 endDynamicIsland() 的流程。
const dynamicIslandOffBtn = el("dynamicIslandOffBtn");
if (dynamicIslandOffBtn) {
  dynamicIslandOffBtn.addEventListener("click", () => {
    if (dynamicIslandBtn) dynamicIslandBtn.click();
  });
}

