/* sun-moon-detail.js — 日出日落／月出月落詳細頁（工具 + 首頁捷徑）+ 月亮高度方位 */
(function () {
  var cacheSun = null;
  var cacheMoon = null;
  var cacheDate = "";
  var openedFrom = "tools"; // tools | home

  // 台灣縣市近似座標（縣市政府所在地）
  var CITY_COORDS = {
    "基隆市": [25.128, 121.741],
    "臺北市": [25.033, 121.565],
    "台北市": [25.033, 121.565],
    "新北市": [25.012, 121.465],
    "桃園市": [24.993, 121.301],
    "新竹市": [24.804, 120.971],
    "新竹縣": [24.839, 121.003],
    "苗栗縣": [24.560, 120.821],
    "臺中市": [24.147, 120.673],
    "台中市": [24.147, 120.673],
    "彰化縣": [24.075, 120.544],
    "南投縣": [23.961, 120.972],
    "雲林縣": [23.709, 120.431],
    "嘉義市": [23.480, 120.449],
    "嘉義縣": [23.459, 120.294],
    "臺南市": [22.999, 120.213],
    "台南市": [22.999, 120.213],
    "高雄市": [22.627, 120.301],
    "屏東縣": [22.682, 120.488],
    "宜蘭縣": [24.702, 121.738],
    "花蓮縣": [23.987, 121.601],
    "臺東縣": [22.755, 121.145],
    "台東縣": [22.755, 121.145],
    "澎湖縣": [23.571, 119.579],
    "金門縣": [24.437, 118.317],
    "連江縣": [26.160, 119.950]
  };

  function el(id) { return document.getElementById(id); }

  function cityLabel() {
    var n = el("cityName");
    return (n && n.textContent ? n.textContent.trim() : "") || "";
  }

  function todayKey() {
    return new Date().toLocaleDateString("sv-SE");
  }

  function getCoords(label) {
    if (!label) return null;
    if (CITY_COORDS[label]) return CITY_COORDS[label];
    // 模糊比對
    var keys = Object.keys(CITY_COORDS);
    for (var i = 0; i < keys.length; i++) {
      if (label.indexOf(keys[i].replace(/[市縣]/g, "")) >= 0 || keys[i].indexOf(label.replace(/[市縣]/g, "")) >= 0) {
        return CITY_COORDS[keys[i]];
      }
    }
    return [25.033, 121.565]; // 預設台北
  }

  /* ========== 月亮高度 / 方位計算（精簡版 SunCalc / Meeus） ========== */
  var PI = Math.PI;
  var rad = PI / 180;
  var dayMs = 1000 * 60 * 60 * 24;
  var J1970 = 2440588;
  var J2000 = 2451545;

  function toJulian(date) {
    return date.valueOf() / dayMs - 0.5 + J1970;
  }
  function toDays(date) {
    return toJulian(date) - J2000;
  }
  function rightAscension(l, b) {
    return Math.atan2(Math.sin(l) * Math.cos(23.4397 * rad) - Math.tan(b) * Math.sin(23.4397 * rad), Math.cos(l));
  }
  function declination(l, b) {
    return Math.asin(Math.sin(b) * Math.cos(23.4397 * rad) + Math.cos(b) * Math.sin(23.4397 * rad) * Math.sin(l));
  }
  function azimuth(H, phi, dec) {
    return Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  }
  function altitude(H, phi, dec) {
    return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  }
  function siderealTime(d, lw) {
    return rad * (280.16 + 360.9856235 * d) - lw;
  }
  function astroRefraction(h) {
    if (h < 0) h = 0;
    return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.0891867));
  }
  function moonCoords(d) {
    var L = rad * (218.316 + 13.176396 * d);
    var M = rad * (134.963 + 13.064993 * d);
    var F = rad * (93.272 + 13.229350 * d);
    var l = L + rad * 6.289 * Math.sin(M);
    var b = rad * 5.128 * Math.sin(F);
    var dt = 385001 - 20905 * Math.cos(M);
    return { ra: rightAscension(l, b), dec: declination(l, b), dist: dt };
  }

  function getMoonPosition(date, lat, lng) {
    var lw = rad * -lng;
    var phi = rad * lat;
    var d = toDays(date);
    var c = moonCoords(d);
    var H = siderealTime(d, lw) - c.ra;
    var h = altitude(H, phi, c.dec);
    h = h + astroRefraction(h);
    // azimuth: 從北順時針（0=北, 90=東, 180=南, 270=西）
    // SunCalc 原始是從南，這裡轉成從北
    var az = (azimuth(H, phi, c.dec) * 180 / PI + 180) % 360;
    if (az < 0) az += 360;
    return {
      altitude: h * 180 / PI,
      azimuth: az,
      distance: c.dist
    };
  }

  function azimuthLabel(deg) {
    if (deg == null || isNaN(deg)) return "—";
    var dirs = ["北", "東北", "東", "東南", "南", "西南", "西", "西北"];
    var idx = Math.round(deg / 45) % 8;
    return dirs[idx] + " " + Math.round(deg) + "°";
  }

  function altitudeLabel(deg) {
    if (deg == null || isNaN(deg)) return "—";
    if (deg < -0.5) return "地平線下 " + Math.abs(Math.round(deg)) + "°";
    return Math.round(deg * 10) / 10 + "°";
  }

  function injectUI() {
    if (!document.querySelector('.tab-btn[data-tab="sunmoon"]')) {
      var btn = document.createElement("button");
      btn.className = "tab-btn hidden";
      btn.setAttribute("data-tab", "sunmoon");
      btn.type = "button";
      btn.textContent = "日出日落";
      var tabs = document.querySelector(".tabs") || document.querySelector(".tab-bar");
      if (tabs) tabs.appendChild(btn);
      else document.body.appendChild(btn);
    }

    if (!el("sunMoonPanel")) {
      var panel = document.createElement("section");
      panel.id = "sunMoonPanel";
      panel.className = "tab-panel";
      panel.innerHTML =
        '<div class="sunmoon-page">' +
        '  <button type="button" class="sunmoon-back" id="sunMoonBack">← 返回</button>' +
        '  <h2 class="sunmoon-title" id="sunMoonTitle">日出日落</h2>' +
        '  <p class="sunmoon-sub" id="sunMoonSub">載入中…</p>' +
        '  <div class="sunmoon-grid" id="sunMoonGrid"></div>' +
        '</div>';
      var main = document.querySelector(".main-content") || document.querySelector(".main") || document.body;
      main.appendChild(panel);
    }

    if (!document.querySelector('.tools-menu-item[data-tab="sunmoon"]')) {
      var item = document.createElement("button");
      item.className = "tools-menu-item";
      item.type = "button";
      item.setAttribute("data-tab", "sunmoon");
      item.innerHTML =
        '<span class="tool-icon" aria-hidden="true">🌅</span>' +
        '<span class="tool-label">日出日落</span>' +
        '<span class="tool-hint">月出月落詳情</span>';
      var forecastGrid = document.querySelector(
        '.tools-section[data-tools-section="forecast"] .tools-grid'
      );
      if (forecastGrid) forecastGrid.appendChild(item);
      else {
        var toolsPage = document.querySelector(".tools-page");
        if (toolsPage) toolsPage.appendChild(item);
      }
    }

    var back = el("sunMoonBack");
    if (back && !back.dataset.bound) {
      back.dataset.bound = "1";
      back.addEventListener("click", function () {
        if (openedFrom === "home") {
          var homeBtn = document.querySelector('.tab-btn[data-tab="forecast"]');
          if (homeBtn) homeBtn.click();
        } else {
          var toolsBtn = document.querySelector('.tab-btn[data-tab="tools"]');
          if (toolsBtn) toolsBtn.click();
        }
      });
    }

    bindHomeCards();
    injectCss();
  }

  function bindHomeCards() {
    // 首頁「其他資訊」的日出／月出卡片 → 點了直接進詳情
    var sunVal = el("sunTimesValue");
    var moonVal = el("moonTimesValue");
    var candidates = [];
    if (sunVal) candidates.push(sunVal.closest(".extra-info-card"));
    if (moonVal) candidates.push(moonVal.closest(".extra-info-card"));

    candidates.forEach(function (card) {
      if (!card || card.dataset.sunmoonBound === "1") return;
      card.dataset.sunmoonBound = "1";
      card.style.cursor = "pointer";
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openPanel("home");
      });
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPanel("home");
        }
      });
    });
  }

  function injectCss() {
    if (el("sunmoon-detail-css")) return;
    var s = document.createElement("style");
    s.id = "sunmoon-detail-css";
    s.textContent =
      ".sunmoon-page{padding:4px 2px 24px;}" +
      ".sunmoon-back{border:none;background:rgba(255,255,255,0.55);border:1px solid rgba(56,189,248,0.35);" +
      "border-radius:12px;padding:8px 14px;font-size:14px;font-weight:600;color:#0369a1;margin-bottom:12px;" +
      "box-shadow:inset 0 1px 0 rgba(255,255,255,0.8);}" +
      ".sunmoon-title{margin:0 0 4px;font-size:22px;font-weight:800;color:#0c4a6e;}" +
      ".sunmoon-sub{margin:0 0 16px;font-size:13px;color:#64748b;}" +
      ".sunmoon-day{margin-bottom:16px;border-radius:20px;padding:14px 14px 10px;" +
      "background:linear-gradient(160deg,rgba(255,255,255,0.72),rgba(224,242,254,0.4));" +
      "border:1px solid rgba(56,189,248,0.4);" +
      "box-shadow:0 8px 24px rgba(14,165,233,0.08),inset 0 1px 0 rgba(255,255,255,0.8);" +
      "backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);}" +
      ".sunmoon-day-head{font-size:15px;font-weight:800;color:#0c4a6e;margin:0 0 12px;" +
      "display:flex;align-items:center;justify-content:space-between;}" +
      ".sunmoon-day-badge{font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;" +
      "background:rgba(14,165,233,0.12);color:#0369a1;}" +
      ".sunmoon-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;}" +
      ".sunmoon-card{border-radius:16px;padding:12px;text-align:center;" +
      "background:rgba(255,255,255,0.55);border:1px solid rgba(255,255,255,0.65);" +
      "box-shadow:inset 0 1px 0 rgba(255,255,255,0.85);}" +
      ".sunmoon-card.sun{background:linear-gradient(160deg,rgba(255,247,237,0.9),rgba(255,255,255,0.55));}" +
      ".sunmoon-card.moon{background:linear-gradient(160deg,rgba(238,242,255,0.9),rgba(255,255,255,0.55));}" +
      ".sunmoon-card.pos{background:linear-gradient(160deg,rgba(224,231,255,0.95),rgba(255,255,255,0.6));" +
      "border-color:rgba(99,102,241,0.35);}" +
      ".sunmoon-icon{font-size:28px;line-height:1.2;margin-bottom:4px;}" +
      ".sunmoon-label{font-size:12px;color:#64748b;margin-bottom:2px;}" +
      ".sunmoon-time{font-size:20px;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums;}" +
      ".sunmoon-remain{font-size:12px;color:#0284c7;margin-top:4px;font-weight:600;min-height:16px;}" +
      ".sunmoon-pos-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px;}" +
      ".sunmoon-pos-note{font-size:11px;color:#64748b;text-align:center;margin:6px 0 2px;}" +
      ".sunmoon-empty{text-align:center;color:#94a3b8;padding:24px 0;}" +
      /* 首頁卡片可點提示 */ +
      ".extra-info-card[data-sunmoon-bound=\"1\"]{cursor:pointer;transition:transform .12s ease,box-shadow .15s ease;}" +
      ".extra-info-card[data-sunmoon-bound=\"1\"]:active{transform:scale(0.97);}";
    document.head.appendChild(s);
  }

  function toMinutes(hhmm) {
    if (!hhmm || typeof hhmm !== "string" || hhmm.indexOf(":") < 0) return null;
    var p = hhmm.split(":").map(Number);
    if (isNaN(p[0]) || isNaN(p[1])) return null;
    return p[0] * 60 + p[1];
  }

  function formatRemaining(mins) {
    if (mins == null || mins < 0) return "";
    if (mins === 0) return "即將到點";
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    if (h > 0 && m > 0) return "還有 " + h + " 小時 " + m + " 分";
    if (h > 0) return "還有 " + h + " 小時";
    return "還有 " + m + " 分";
  }

  function remainText(hhmm, dayOffset) {
    var mins = toMinutes(hhmm);
    if (mins == null) return "";
    var now = new Date();
    var nowMins = now.getHours() * 60 + now.getMinutes();
    var target = mins + (dayOffset || 0) * 24 * 60;
    var diff = target - nowMins;
    if (diff < 0) return "已過";
    return formatRemaining(diff);
  }

  function card(kind, icon, label, time, remain) {
    var t = time || "—";
    var r = remain || "";
    return (
      '<div class="sunmoon-card ' + kind + '">' +
      '<div class="sunmoon-icon">' + icon + "</div>" +
      '<div class="sunmoon-label">' + label + "</div>" +
      '<div class="sunmoon-time">' + t + "</div>" +
      '<div class="sunmoon-remain">' + r + "</div>" +
      "</div>"
    );
  }

  function dayBlock(title, badge, sun, moon, dayOffset, moonPos) {
    sun = sun || {};
    moon = moon || {};
    var sr = sun.SunRiseTime || "";
    var ss = sun.SunSetTime || "";
    var mr = moon.MoonRiseTime || "";
    var ms = moon.MoonSetTime || "";

    var posHtml = "";
    if (moonPos && dayOffset === 0) {
      posHtml =
        '<div class="sunmoon-pos-note">目前月亮位置（即時計算）</div>' +
        '<div class="sunmoon-pos-row">' +
        card("pos", "📐", "月亮高度", altitudeLabel(moonPos.altitude), "") +
        card("pos", "🧭", "月亮方位", azimuthLabel(moonPos.azimuth), "") +
        "</div>";
    }

    return (
      '<div class="sunmoon-day">' +
      '<div class="sunmoon-day-head"><span>' + title + "</span>" +
      (badge ? '<span class="sunmoon-day-badge">' + badge + "</span>" : "") +
      "</div>" +
      '<div class="sunmoon-row">' +
      card("sun", "🌅", "日出", sr, remainText(sr, dayOffset)) +
      card("sun", "🌇", "日落", ss, remainText(ss, dayOffset)) +
      "</div>" +
      '<div class="sunmoon-row">' +
      card("moon", "🌕", "月出", mr || "—", mr ? remainText(mr, dayOffset) : "") +
      card("moon", "🌑", "月落", ms || "—", ms ? remainText(ms, dayOffset) : "") +
      "</div>" +
      posHtml +
      "</div>"
    );
  }

  async function ensureData() {
    var key = todayKey();
    if (cacheSun && cacheMoon && cacheDate === key) return;
    if (!window.weatherAPI) throw new Error("no api");
    var sunRes = await window.weatherAPI.getSunTimes();
    var moonRes = await window.weatherAPI.getMoonTimes();
    if (sunRes && sunRes.ok) cacheSun = sunRes.counties || {};
    if (moonRes && moonRes.ok) cacheMoon = moonRes.counties || {};
    cacheDate = key;
  }

  function render() {
    var label = cityLabel();
    var sub = el("sunMoonSub");
    var grid = el("sunMoonGrid");
    var title = el("sunMoonTitle");
    if (title) title.textContent = "日出日落 · 月出月落";
    if (!grid) return;

    if (!label) {
      if (sub) sub.textContent = "請先選擇城市";
      grid.innerHTML = '<p class="sunmoon-empty">尚無城市資料</p>';
      return;
    }

    if (sub) sub.textContent = label + " · 資料來源：中央氣象署 + 即時計算";

    var sunDays = (cacheSun && cacheSun[label]) || [];
    var moonDays = (cacheMoon && cacheMoon[label]) || [];
    var todaySun = sunDays[0];
    var tmrSun = sunDays[1];
    var todayMoon = moonDays[0];
    var tmrMoon = moonDays[1];

    if (!todaySun && !todayMoon) {
      grid.innerHTML = '<p class="sunmoon-empty">暫無天文資料</p>';
      return;
    }

    // 計算目前月亮高度 / 方位
    var coords = getCoords(label);
    var moonPos = null;
    if (coords) {
      try {
        moonPos = getMoonPosition(new Date(), coords[0], coords[1]);
      } catch (e) {
        moonPos = null;
      }
    }

    var html = "";
    html += dayBlock("今天", "今日", todaySun, todayMoon, 0, moonPos);
    if (tmrSun || tmrMoon) html += dayBlock("明天", "次日", tmrSun, tmrMoon, 1, null);
    grid.innerHTML = html;
  }

  function openPanel(from) {
    openedFrom = from || "tools";
    document.querySelectorAll(".tab-btn").forEach(function (b) {
      b.classList.remove("active");
    });
    document.querySelectorAll(".tab-panel").forEach(function (p) {
      p.classList.remove("active");
    });
    var tab = document.querySelector('.tab-btn[data-tab="sunmoon"]');
    if (tab) tab.classList.add("active");
    var panel = el("sunMoonPanel");
    if (panel) panel.classList.add("active");

    var main = document.querySelector(".main");
    if (main) main.scrollTo({ top: 0, behavior: "smooth" });

    ensureData()
      .then(render)
      .catch(function () {
        var grid = el("sunMoonGrid");
        if (grid) grid.innerHTML = '<p class="sunmoon-empty">載入失敗，請稍後再試</p>';
      });
  }

  function boot() {
    injectUI();
    // 延遲再綁一次（首頁卡片可能較晚渲染）
    setTimeout(bindHomeCards, 800);
    setTimeout(bindHomeCards, 2000);

    document.addEventListener(
      "click",
      function (e) {
        var t = e.target.closest('.tools-menu-item[data-tab="sunmoon"]');
        if (t) {
          e.preventDefault();
          e.stopPropagation();
          openPanel("tools");
        }
      },
      true
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(boot, 300);
    });
  } else {
    setTimeout(boot, 300);
  }
})();
