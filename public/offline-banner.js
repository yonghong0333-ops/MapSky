/* offline-banner.js — 離線提示：先由上滑出，再收進城市玻璃島 */
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
      "background:linear-gradient(160deg,rgba(255,247,237,0.94),rgba(255,237,213,0.8) 55%,rgba(254,215,170,0.6));" +
      "border:1px solid rgba(251,146,60,0.55);" +
      "box-shadow:0 0 0 1px rgba(251,146,60,0.18),0 10px 28px rgba(234,88,12,0.18),inset 0 1px 0 rgba(255,255,255,0.75);" +
      "backdrop-filter:blur(24px) saturate(180%);-webkit-backdrop-filter:blur(24px) saturate(180%);" +
      "color:#9a3412;font-size:13px;font-weight:700;line-height:1.35;" +
      "transform:translateY(-120%) scale(0.96);opacity:0;" +
      "transition:transform .4s cubic-bezier(.16,1.15,.3,1),opacity .25s ease,top .55s cubic-bezier(.22,1,.36,1),left .55s ease,right .55s ease,border-radius .45s ease,padding .45s ease;" +
      "pointer-events:none;" +
      "}" +
      "#" + BANNER_ID + ".is-visible{" +
      "transform:translateY(0) scale(1);opacity:1;pointer-events:auto;" +
      "}" +
      "#" + BANNER_ID + ".is-merging{" +
      "pointer-events:none;" +
      "opacity:0;" +
      "transform:translateY(0) scale(0.92);" +
      "}" +
      "#" + BANNER_ID + " .ob-icon{flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#c2410c;}" +
      "#" + BANNER_ID + " .ob-icon svg{display:block;}" +
      "#" + BANNER_ID + " .ob-text{flex:1;min-width:0;}" +
      "#" + BANNER_ID + " .ob-sub{display:block;margin-top:2px;font-size:11px;font-weight:600;color:#c2410c;opacity:.9;}" +
      "#" + BANNER_ID + " .ob-close{" +
      "flex-shrink:0;width:28px;height:28px;border-radius:50%;border:none;" +
      "background:rgba(154,52,18,0.1);color:#9a3412;font-size:14px;font-weight:700;" +
      "cursor:pointer;display:flex;align-items:center;justify-content:center;" +
      "}" +
      ".main-header{" +
      "transition:background .45s ease,border-color .45s ease,box-shadow .45s ease,padding .35s ease !important;" +
      "}" +
      ".main-header." + HEADER_OFFLINE + "{" +
      "background:linear-gradient(160deg,rgba(255,247,237,0.92),rgba(255,237,213,0.72) 50%,rgba(254,215,170,0.5)) !important;" +
      "border:1px solid rgba(251,146,60,0.55) !important;" +
      "box-shadow:0 0 0 1px rgba(251,146,60,0.15),0 8px 24px rgba(234,88,12,0.14),inset 0 1px 0 rgba(255,255,255,0.8) !important;" +
      "padding:12px 14px 10px !important;" +
      "}" +
      ".main-header." + HEADER_OFFLINE + " #cityName," +
      ".main-header." + HEADER_OFFLINE + " h2{" +
      "color:#9a3412 !important;" +
      "}" +
      ".main-header .offline-island-row{" +
      "display:none;align-items:center;gap:6px;margin-top:6px;" +
      "font-size:11px;font-weight:700;color:#c2410c;line-height:1.3;" +
      "opacity:0;transform:translateY(-6px);" +
      "transition:opacity .35s ease .05s,transform .4s cubic-bezier(.16,1.1,.3,1) .05s;" +
      "}" +
      ".main-header." + HEADER_OFFLINE + " .offline-island-row{" +
      "display:flex;opacity:1;transform:translateY(0);" +
      "}" +
      ".main-header .offline-island-row .oi-icon{" +
      "display:flex;align-items:center;flex-shrink:0;color:#c2410c;" +
      "}" +
      ".main-header .offline-island-row .oi-icon svg{display:block;}" +
      ".main-header." + HEADER_OFFLINE + " .fav-star-btn{" +
      "background:rgba(255,255,255,0.55) !important;" +
      "border-color:rgba(251,146,60,0.35) !important;" +
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
      '<span class="oi-text">網路連線不穩定 · 顯示備份資料</span>';
    h.appendChild(row);
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
      if (!raw) return "將顯示上次備份的天氣資料";
      var bundle = JSON.parse(raw);
      if (!bundle || !bundle.savedAt) return "將顯示上次備份的天氣資料";
      var mins = Math.max(0, Math.round((Date.now() - bundle.savedAt) / 60000));
      var age;
      if (mins < 1) age = "剛剛";
      else if (mins < 60) age = mins + " 分鐘前";
      else if (mins < 48 * 60) age = Math.round(mins / 60) + " 小時前";
      else age = Math.round(mins / 1440) + " 天前";
      return "顯示 " + age + " 的備份資料";
    } catch (e) {
      return "將顯示上次備份的天氣資料";
    }
  }

  function mergeIntoIsland() {
    var b = document.getElementById(BANNER_ID);
    var h = headerEl();
    if (b) {
      b.classList.add("is-merging");
      b.classList.remove("is-visible");
    }
    ensureHeaderOfflineRow();
    var row = h && h.querySelector(".offline-island-row .oi-text");
    if (row) {
      var hint = ageHint();
      row.textContent = "網路連線不穩定 · " + hint.replace(/^顯示\s*/, "");
    }
    if (h) h.classList.add(HEADER_OFFLINE);
    setTimeout(function () {
      if (b) b.classList.remove("is-merging");
    }, 500);
  }

  function onOffline() {
    isOffline = true;
    if (mergeTimer) clearTimeout(mergeTimer);
    var b = ensureBanner();
    var sub = b.querySelector(".ob-sub");
    if (sub) sub.textContent = ageHint();
    b.classList.remove("is-merging");
    b.classList.remove("is-visible");
    void b.offsetHeight;
    b.classList.add("is-visible");
    mergeTimer = setTimeout(function () {
      if (!isOffline) return;
      mergeIntoIsland();
    }, 900);
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
      b.classList.remove("is-merging");
    }
    var h = headerEl();
    if (h) h.classList.remove(HEADER_OFFLINE);
  }

  function boot() {
    injectCss();
    ensureBanner();
    ensureHeaderOfflineRow();
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setTimeout(onOffline, 500);
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
