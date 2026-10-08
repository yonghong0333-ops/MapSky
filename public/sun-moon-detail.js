/* sun-moon-detail.js — 日出日落／月出月落詳細頁（工具） */
(function () {
  var cacheSun = null;
  var cacheMoon = null;
  var cacheDate = "";

  function el(id) { return document.getElementById(id); }

  function cityLabel() {
    var n = el("cityName");
    return (n && n.textContent ? n.textContent.trim() : "") || "";
  }

  function todayKey() {
    return new Date().toLocaleDateString("sv-SE");
  }

  function injectUI() {
    // hidden tab button
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

    // panel
    if (!el("sunMoonPanel")) {
      var panel = document.createElement("section");
      panel.id = "sunMoonPanel";
      panel.className = "tab-panel";
      panel.innerHTML =
        '<div class="sunmoon-page">' +
        '  <button type="button" class="sunmoon-back" id="sunMoonBack">← 返回工具</button>' +
        '  <h2 class="sunmoon-title" id="sunMoonTitle">日出日落</h2>' +
        '  <p class="sunmoon-sub" id="sunMoonSub">載入中…</p>' +
        '  <div class="sunmoon-grid" id="sunMoonGrid"></div>' +
        '</div>';
      var main = document.querySelector(".main-content") || document.querySelector(".main") || document.body;
      main.appendChild(panel);
    }

    // tools menu item
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
      if (forecastGrid) {
        forecastGrid.appendChild(item);
      } else {
        var toolsPage = document.querySelector(".tools-page");
        if (toolsPage) toolsPage.appendChild(item);
      }

      item.addEventListener("click", function () {
        openPanel();
      });
    }

    var back = el("sunMoonBack");
    if (back && !back.dataset.bound) {
      back.dataset.bound = "1";
      back.addEventListener("click", function () {
        var toolsBtn = document.querySelector('.tab-btn[data-tab="tools"]');
        if (toolsBtn) toolsBtn.click();
      });
    }

    injectCss();
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
      ".sunmoon-icon{font-size:28px;line-height:1.2;margin-bottom:4px;}" +
      ".sunmoon-label{font-size:12px;color:#64748b;margin-bottom:2px;}" +
      ".sunmoon-time{font-size:20px;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums;}" +
      ".sunmoon-remain{font-size:12px;color:#0284c7;margin-top:4px;font-weight:600;min-height:16px;}" +
      ".sunmoon-empty{text-align:center;color:#94a3b8;padding:24px 0;}";
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
    var cur = nowMins;
    var diff = target - cur;
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

  function dayBlock(title, badge, sun, moon, dayOffset) {
    sun = sun || {};
    moon = moon || {};
    var sr = sun.SunRiseTime || "";
    var ss = sun.SunSetTime || "";
    var mr = moon.MoonRiseTime || "";
    var ms = moon.MoonSetTime || "";
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

    if (sub) sub.textContent = label + " · 資料來源：中央氣象署";

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

    var html = "";
    html += dayBlock("今天", "今日", todaySun, todayMoon, 0);
    if (tmrSun || tmrMoon) {
      html += dayBlock("明天", "次日", tmrSun, tmrMoon, 1);
    }
    grid.innerHTML = html;
  }

  function openPanel() {
    // activate panel like other tabs
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
    // re-bind tools item if tools page re-rendered
    document.addEventListener(
      "click",
      function (e) {
        var t = e.target.closest('.tools-menu-item[data-tab="sunmoon"]');
        if (t) {
          e.preventDefault();
          e.stopPropagation();
          openPanel();
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
