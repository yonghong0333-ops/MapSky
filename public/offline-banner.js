/* offline-banner.js — 離線提示：由上滑出 → 飛入城市玻璃島 */
(function () {
  var BANNER_ID = "mapskyOfflineBanner";
  var STYLE_ID = "mapsky-offline-banner-css";
  var HEADER_OFFLINE = "is-offline-island";
  var mergeTimer = null;
  var isOffline = false;

  var WIFI_ICON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M5 12.55a11 11 0 0 1 14.08 0"/>' +
    '<path d="M1.42 9a16 16 0 0 1 21.16 0"/>' +
    '<path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>' +
    '<line x1="12" y1="20" x2="12.01" y2="20"/>' +
    "</svg>";

  function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
      "#" + BANNER_ID + "{" +
      "position:fixed;left:12px;right:12px;top:calc(10px + env(safe-area-inset-top,0px));" +
      "z-index:100000;padding:12px 14px;border-radius:16px;" +
      "display:flex;align-items:center;gap:10px;" +
      "background:linear-gradient(160deg,rgba(255,247,237,0.95),rgba(255,237,213,0.82) 55%,rgba(254,215,170,0.62));" +
      "border:1px solid rgba(251,146,60,0.55);" +
      "box-shadow:0 0 0 1px rgba(251,146,60,0.18),0 12px 32px rgba(234,88,12,0.2),inset 0 1px 0 rgba(255,255,255,0.8);" +
      "backdrop-filter:blur(24px) saturate(180%);-webkit-backdrop-filter:blur(24px) saturate(180%);" +
      "color:#9a3412;font-size:13px;font-weight:700;line-height:1.35;" +
      "transform:translate3d(0,-130%,0) scale(0.94);opacity:0;" +
      "transition:none;" +
      "pointer-events:none;will-change:transform,opacity,top,left,width,border-radius;" +
      "}" +
      "#" + BANNER_ID + ".is-visible{" +
      "transform:translate3d(0,0,0) scale(1);opacity:1;" +
      "transition:transform .45s cubic-bezier(.16,1.2,.3,1),opacity .3s ease-out;" +
      "}" +
      "#" + BANNER_ID + ".is-flying{" +
      "transition:transform .62s cubic-bezier(.22,1,.36,1),opacity .5s ease .12s,border-radius .5s ease;" +
      "opacity:0;" +
      "}" +
      "#" + BANNER_ID + " .ob-icon{flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#c2410c;}" +
      "#" + BANNER_ID + " .ob-icon svg{display:block;}" +
      "#" + BANNER_ID + " .ob-text{flex:1;min-width:0;}" +
      "#" + BANNER_ID + " .ob-sub{display:block;margin-top:2px;font-size:11px;font-weight:600;color:#c2410c;opacity:.9;}" +
      ".main-header{" +
      "position:relative !important;" +
      "transition:background .5s ease,border-color .5s ease,box-shadow .5s ease,transform .45s cubic-bezier(.16,1.2,.3,1) !important;" +
      "}" +
      ".main-header." + HEADER_OFFLINE + "{" +
      "background:linear-gradient(160deg,rgba(255,247,237,0.94),rgba(255,237,213,0.75) 50%,rgba(254,215,170,0.52)) !important;" +
      "border:1px solid rgba(251,146,60,0.55) !important;" +
      "box-shadow:0 0 0 1px rgba(251,146,60,0.16),0 8px 26px rgba(234,88,12,0.16),inset 0 1px 0 rgba(255,255,255,0.85) !important;" +
      "}" +
      ".main-header." + HEADER_OFFLINE + " #cityName," +
      ".main-header." + HEADER_OFFLINE + " h2{" +
      "color:#9a3412 !important;" +
      "transition:color .4s ease !important;" +
      "}" +
      ".main-header .offline-island-row{" +
      "display:flex;align-items:center;gap:5px;" +
      "max-width:0;opacity:0;overflow:hidden;" +
      "margin-left:0;padding-left:0;" +
      "font-size:11px;font-weight:700;color:#c2410c;line-height:1.25;white-space:nowrap;" +
      "transform:translateX(12px) scale(0.9);" +
      "transition:max-width .55s cubic-bezier(.16,1.15,.3,1),opacity .4s ease,transform .5s cubic-bezier(.16,1.2,.3,1),margin .4s ease,padding .4s ease;" +
      "}" +
      ".main-header." + HEADER_OFFLINE + " .offline-island-row{" +
      "max-width:220px;opacity:1;transform:translateX(0) scale(1);" +
      "margin-left:8px;padding-left:8px;" +
      "border-left:1px solid rgba(251,146,60,0.35);" +
      "}" +
      ".main-header .offline-island-row .oi-icon{" +
      "display:flex;align-items:center;flex-shrink:0;color:#c2410c;" +
      "}" +
      ".main-header .offline-island-row .oi-icon svg{display:block;width:15px;height:15px;}" +
      ".main-header." + HEADER_OFFLINE + " .fav-star-btn{" +
      "background:rgba(255,255,255,0.55) !important;" +
      "border-color:rgba(251,146,60,0.35) !important;" +
      "transition:background .4s ease,border-color .4s ease !important;" +
      "}" +
      ".main-header.is-island-pulse{" +
      "animation:islandPulse .55s cubic-bezier(.16,1.4,.3,1) both;" +
      "}" +
      "@keyframes islandPulse{" +
      "0%{transform:scale(1);}" +
      "35%{transform:scale(1.035);}" +
      "70%{transform:scale(0.985);}" +
      "100%{transform:scale(1);}" +
      "}";
    document.head.appendChild(s);
  }

  function headerEl() {
    return document.querySelector(".main-header");
  }

  function ensureHeaderOfflineRow() {
    var h = headerEl();
    if (!h) return null;
    var row = h.querySelector(".offline-island-row");
    if (row) return row;
    row = document.createElement("div");
    row.className = "offline-island-row";
    row.innerHTML =
      '<span class="oi-icon">' + WIFI_ICON + "</span>" +
      '<span class="oi-text">網路連線不穩定</span>';
    var star = h.querySelector(".fav-star-btn");
    if (star && star.parentNode === h) {
      if (star.nextSibling) h.insertBefore(row, star.nextSibling);
      else h.appendChild(row);
    } else {
      h.appendChild(row);
    }
    var cs = window.getComputedStyle(h);
    if (cs.display !== "flex") {
      h.style.display = "flex";
      h.style.alignItems = "center";
      h.style.flexWrap = "nowrap";
    }
    return row;
  }

  function ensureBanner() {
    injectCss();
    var b = document.getElementById(BANNER_ID);
    if (b) return b;
    b = document.createElement("div");
    b.id = BANNER_ID;
    b.setAttribute("role", "status");
    b.setAttribute("aria-live", "polite");
    b.innerHTML =
      '<span class="ob-icon">' + WIFI_ICON + "</span>" +
      '<span class="ob-text">' +
      '<span class="ob-main">網路連線不穩定</span>' +
      '<span class="ob-sub">將顯示上次備份的天氣資料</span>' +
      "</span>";
    document.body.appendChild(b);
    return b;
  }

  function ageHint() {
    try {
      var raw = localStorage.getItem("mapsky_offline_weather_bundle_v1");
      if (!raw) return "顯示備份資料";
      var bundle = JSON.parse(raw);
      if (!bundle || !bundle.savedAt) return "顯示備份資料";
      var mins = Math.max(0, Math.round((Date.now() - bundle.savedAt) / 60000));
      var age;
      if (mins < 1) age = "剛剛";
      else if (mins < 60) age = mins + " 分鐘前";
      else if (mins < 48 * 60) age = Math.round(mins / 60) + " 小時前";
      else age = Math.round(mins / 1440) + " 天前";
      return age + " 的備份資料";
    } catch (e) {
      return "顯示備份資料";
    }
  }

  function flyIntoIsland() {
    var b = document.getElementById(BANNER_ID);
    var h = headerEl();
    if (!b || !h) {
      activateIsland();
      return;
    }

    var bRect = b.getBoundingClientRect();
    var hRect = h.getBoundingClientRect();

    var dx = hRect.left + hRect.width * 0.55 - (bRect.left + bRect.width / 2);
    var dy = hRect.top + hRect.height / 2 - (bRect.top + bRect.height / 2);
    var scale = Math.max(0.28, Math.min(0.55, hRect.width / Math.max(bRect.width, 1)));

    b.classList.add("is-visible");
    b.classList.remove("is-flying");
    void b.offsetHeight;

    b.style.transform =
      "translate3d(" + dx + "px," + dy + "px,0) scale(" + scale + ")";
    b.classList.add("is-flying");

    setTimeout(function () {
      if (!isOffline) return;
      activateIsland();
    }, 280);

    setTimeout(function () {
      b.classList.remove("is-visible");
      b.classList.remove("is-flying");
      b.style.transform = "";
    }, 700);
  }

  function activateIsland() {
    var h = headerEl();
    if (!h) return;
    ensureHeaderOfflineRow();
    var text = h.querySelector(".offline-island-row .oi-text");
    if (text) text.textContent = "網路連線不穩定 · " + ageHint();
    h.classList.add(HEADER_OFFLINE);
    h.classList.remove("is-island-pulse");
    void h.offsetHeight;
    h.classList.add("is-island-pulse");
    setTimeout(function () {
      h.classList.remove("is-island-pulse");
    }, 600);
  }

  function onOffline() {
    isOffline = true;
    if (mergeTimer) clearTimeout(mergeTimer);

    var b = ensureBanner();
    var sub = b.querySelector(".ob-sub");
    if (sub) sub.textContent = "將顯示 " + ageHint();

    b.classList.remove("is-flying");
    b.classList.remove("is-visible");
    b.style.transform = "";
    void b.offsetHeight;
    b.classList.add("is-visible");

    mergeTimer = setTimeout(function () {
      if (!isOffline) return;
      flyIntoIsland();
    }, 1000);
  }

  function onOnline() {
    isOffline = false;
    if (mergeTimer) {
      clearTimeout(mergeTimer);
      mergeTimer = null;
    }
    var b = document.getElementById(BANNER_ID);
    if (b) {
      b.classList.remove("is-visible");
      b.classList.remove("is-flying");
      b.style.transform = "";
    }
    var h = headerEl();
    if (h) {
      h.classList.remove(HEADER_OFFLINE);
      h.classList.remove("is-island-pulse");
    }
  }

  function boot() {
    injectCss();
    ensureBanner();
    setTimeout(ensureHeaderOfflineRow, 400);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setTimeout(onOffline, 600);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(boot, 250);
    });
  } else {
    setTimeout(boot, 250);
  }
})();
