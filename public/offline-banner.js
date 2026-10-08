/* offline-banner.js — 離線：頂部提示飛入縣市與星星中間的網路圖示；長按看詳情 */
(function () {
  var BANNER_ID = "mapskyOfflineBanner";
  var STYLE_ID = "mapsky-offline-banner-css";
  var HEADER_OFFLINE = "is-offline-island";
  var mergeTimer = null;
  var isOffline = false;
  var longPressTimer = null;
  var detailHideTimer = null;

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
      "transition:none;pointer-events:none;will-change:transform,opacity;" +
      "}" +
      "#" + BANNER_ID + ".is-visible{" +
      "transform:translate3d(0,0,0) scale(1);opacity:1;" +
      "transition:transform .45s cubic-bezier(.16,1.2,.3,1),opacity .3s ease-out;" +
      "}" +
      "#" + BANNER_ID + ".is-flying{" +
      "transition:transform .58s cubic-bezier(.22,1,.36,1),opacity .45s ease .1s;" +
      "opacity:0;" +
      "}" +
      "#" + BANNER_ID + " .ob-icon{flex-shrink:0;display:flex;align-items:center;color:#c2410c;}" +
      "#" + BANNER_ID + " .ob-text{flex:1;min-width:0;}" +
      "#" + BANNER_ID + " .ob-sub{display:block;margin-top:2px;font-size:11px;font-weight:600;color:#c2410c;opacity:.9;}" +
      ".main-header{" +
      "position:relative !important;" +
      "transition:background .45s ease,border-color .45s ease,box-shadow .45s ease !important;" +
      "}" +
      ".main-header." + HEADER_OFFLINE + "{" +
      "background:linear-gradient(160deg,rgba(255,247,237,0.94),rgba(255,237,213,0.75) 50%,rgba(254,215,170,0.52)) !important;" +
      "border:1px solid rgba(251,146,60,0.55) !important;" +
      "box-shadow:0 0 0 1px rgba(251,146,60,0.16),0 8px 26px rgba(234,88,12,0.14),inset 0 1px 0 rgba(255,255,255,0.85) !important;" +
      "}" +
      ".main-header." + HEADER_OFFLINE + " #cityName," +
      ".main-header." + HEADER_OFFLINE + " h2{" +
      "color:#9a3412 !important;" +
      "transition:color .35s ease !important;" +
      "}" +
      ".main-header." + HEADER_OFFLINE + " .fav-star-btn{" +
      "background:rgba(255,255,255,0.55) !important;" +
      "border-color:rgba(251,146,60,0.35) !important;" +
      "}" +
      ".main-header .offline-net-btn{" +
      "display:none;align-items:center;justify-content:center;" +
      "width:0;height:32px;margin:0;padding:0;border:none;border-radius:10px;" +
      "background:rgba(255,255,255,0.55);color:#c2410c;" +
      "opacity:0;transform:scale(0.5);" +
      "cursor:pointer;-webkit-user-select:none;user-select:none;" +
      "touch-action:manipulation;" +
      "transition:width .4s cubic-bezier(.16,1.2,.3,1),opacity .35s ease,transform .4s cubic-bezier(.16,1.3,.3,1),margin .35s ease,background .2s ease;" +
      "}" +
      ".main-header." + HEADER_OFFLINE + " .offline-net-btn{" +
      "display:inline-flex;width:32px;margin:0 6px;opacity:1;transform:scale(1);" +
      "border:1px solid rgba(251,146,60,0.35);" +
      "box-shadow:inset 0 1px 0 rgba(255,255,255,0.7);" +
      "}" +
      ".main-header .offline-net-btn:active{" +
      "background:rgba(254,215,170,0.85);" +
      "transform:scale(0.92);" +
      "}" +
      ".main-header .offline-net-btn svg{display:block;width:17px;height:17px;pointer-events:none;}" +
      ".main-header .offline-detail-tip{" +
      "position:absolute;left:50%;top:calc(100% + 8px);transform:translateX(-50%) translateY(-6px) scale(0.92);" +
      "z-index:50;min-width:160px;max-width:min(280px,86vw);padding:10px 12px;border-radius:14px;" +
      "background:linear-gradient(160deg,rgba(255,247,237,0.97),rgba(255,237,213,0.9));" +
      "border:1px solid rgba(251,146,60,0.5);" +
      "box-shadow:0 10px 28px rgba(234,88,12,0.18),inset 0 1px 0 rgba(255,255,255,0.85);" +
      "backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);" +
      "color:#9a3412;font-size:12px;font-weight:700;line-height:1.4;text-align:center;" +
      "opacity:0;pointer-events:none;" +
      "transition:opacity .25s ease,transform .3s cubic-bezier(.16,1.2,.3,1);" +
      "white-space:normal;" +
      "}" +
      ".main-header .offline-detail-tip.is-show{" +
      "opacity:1;transform:translateX(-50%) translateY(0) scale(1);pointer-events:auto;" +
      "}" +
      ".main-header .offline-detail-tip .od-title{font-size:13px;margin-bottom:2px;}" +
      ".main-header .offline-detail-tip .od-sub{font-size:11px;font-weight:600;color:#c2410c;opacity:.95;}" +
      ".main-header.is-island-pulse{animation:islandPulse .5s cubic-bezier(.16,1.4,.3,1) both;}" +
      "@keyframes islandPulse{0%{transform:scale(1)}35%{transform:scale(1.03)}70%{transform:scale(0.99)}100%{transform:scale(1)}}";
    document.head.appendChild(s);
  }

  function headerEl() {
    return document.querySelector(".main-header");
  }

  function ageHint() {
    try {
      var raw = localStorage.getItem("mapsky_offline_weather_bundle_v1");
      if (!raw) return "顯示上次備份資料";
      var bundle = JSON.parse(raw);
      if (!bundle || !bundle.savedAt) return "顯示上次備份資料";
      var mins = Math.max(0, Math.round((Date.now() - bundle.savedAt) / 60000));
      var age;
      if (mins < 1) age = "剛剛";
      else if (mins < 60) age = mins + " 分鐘前";
      else if (mins < 48 * 60) age = Math.round(mins / 60) + " 小時前";
      else age = Math.round(mins / 1440) + " 天前";
      return age + " 的備份資料";
    } catch (e) {
      return "顯示上次備份資料";
    }
  }

  function ensureNetBtn() {
    var h = headerEl();
    if (!h) return null;
    var btn = h.querySelector(".offline-net-btn");
    if (btn) return btn;

    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "offline-net-btn";
    btn.setAttribute("aria-label", "網路狀態，長按查看詳情");
    btn.innerHTML = WIFI_ICON;

    var star = h.querySelector(".fav-star-btn");
    if (star) {
      h.insertBefore(btn, star);
    } else {
      h.appendChild(btn);
    }

    var tip = h.querySelector(".offline-detail-tip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "offline-detail-tip";
      tip.innerHTML =
        '<div class="od-title">網路連線不穩定</div>' +
        '<div class="od-sub">將顯示上次備份資料</div>';
      h.appendChild(tip);
    }

    bindLongPress(btn, tip);

    var cs = window.getComputedStyle(h);
    if (cs.display !== "flex") {
      h.style.display = "flex";
      h.style.alignItems = "center";
      h.style.flexWrap = "nowrap";
    }
    return btn;
  }

  function showDetail(tip) {
    if (!tip) return;
    var sub = tip.querySelector(".od-sub");
    if (sub) sub.textContent = "顯示 " + ageHint();
    tip.classList.add("is-show");
    if (detailHideTimer) clearTimeout(detailHideTimer);
    detailHideTimer = setTimeout(function () {
      tip.classList.remove("is-show");
    }, 3200);
  }

  function hideDetail(tip) {
    if (detailHideTimer) {
      clearTimeout(detailHideTimer);
      detailHideTimer = null;
    }
    if (tip) tip.classList.remove("is-show");
  }

  function bindLongPress(btn, tip) {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    var startX = 0;
    var startY = 0;

    function clearLP() {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }

    function start(e) {
      clearLP();
      var t = e.touches && e.touches[0];
      startX = t ? t.clientX : e.clientX || 0;
      startY = t ? t.clientY : e.clientY || 0;
      longPressTimer = setTimeout(function () {
        longPressTimer = null;
        showDetail(tip);
        try {
          if (navigator.vibrate) navigator.vibrate(12);
        } catch (err) {}
      }, 420);
    }

    function move(e) {
      if (!longPressTimer) return;
      var t = e.touches && e.touches[0];
      var x = t ? t.clientX : e.clientX || 0;
      var y = t ? t.clientY : e.clientY || 0;
      if (Math.abs(x - startX) > 10 || Math.abs(y - startY) > 10) clearLP();
    }

    function end() {
      clearLP();
    }

    btn.addEventListener("touchstart", start, { passive: true });
    btn.addEventListener("touchmove", move, { passive: true });
    btn.addEventListener("touchend", end);
    btn.addEventListener("touchcancel", end);
    btn.addEventListener("mousedown", start);
    btn.addEventListener("mouseup", end);
    btn.addEventListener("mouseleave", end);
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
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

  function flyIntoNetBtn() {
    var b = document.getElementById(BANNER_ID);
    var btn = ensureNetBtn();
    var h = headerEl();
    if (!b || !btn || !h) {
      activateIsland();
      return;
    }

    var bRect = b.getBoundingClientRect();
    var tRect = btn.getBoundingClientRect();
    if (tRect.width < 4) {
      var star = h.querySelector(".fav-star-btn");
      var city = h.querySelector("#cityName") || h.querySelector("h2");
      if (star && city) {
        var cR = city.getBoundingClientRect();
        var sR = star.getBoundingClientRect();
        tRect = {
          left: (cR.right + sR.left) / 2 - 16,
          top: (cR.top + sR.top) / 2,
          width: 32,
          height: 32
        };
      }
    }

    var dx = tRect.left + tRect.width / 2 - (bRect.left + bRect.width / 2);
    var dy = tRect.top + tRect.height / 2 - (bRect.top + bRect.height / 2);

    b.classList.add("is-visible");
    b.classList.remove("is-flying");
    void b.offsetHeight;

    b.style.transform = "translate3d(" + dx + "px," + dy + "px,0) scale(0.18)";
    b.classList.add("is-flying");

    setTimeout(function () {
      if (!isOffline) return;
      activateIsland();
    }, 260);

    setTimeout(function () {
      b.classList.remove("is-visible");
      b.classList.remove("is-flying");
      b.style.transform = "";
    }, 680);
  }

  function activateIsland() {
    var h = headerEl();
    if (!h) return;
    ensureNetBtn();
    h.classList.add(HEADER_OFFLINE);
    h.classList.remove("is-island-pulse");
    void h.offsetHeight;
    h.classList.add("is-island-pulse");
    setTimeout(function () {
      h.classList.remove("is-island-pulse");
    }, 550);
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
      flyIntoNetBtn();
    }, 950);
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
      var tip = h.querySelector(".offline-detail-tip");
      hideDetail(tip);
    }
  }

  function boot() {
    injectCss();
    ensureBanner();
    setTimeout(ensureNetBtn, 400);
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
