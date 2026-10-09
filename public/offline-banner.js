/* offline-banner.js — 離線：飛入縣市與星星中間；星星靠右；長按在玻璃島上展開詳情 */
(function () {
  var BANNER_ID = "mapskyOfflineBanner";
  var STYLE_ID = "mapsky-offline-banner-css";
  var HEADER_OFFLINE = "is-offline-island";
  var HEADER_DETAIL = "is-offline-detail";
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
      "display:flex !important;align-items:center !important;flex-wrap:nowrap !important;" +
      "position:relative !important;" +
      "transition:background .45s ease,border-color .45s ease,box-shadow .45s ease,padding .28s ease !important;" +
      "transform:translateZ(0);" +
      "}" +
      ".main-header." + HEADER_OFFLINE + "{" +
      "background:linear-gradient(160deg,rgba(255,247,237,0.94),rgba(255,237,213,0.75) 50%,rgba(254,215,170,0.52)) !important;" +
      "border:1px solid rgba(251,146,60,0.55) !important;" +
      "box-shadow:0 0 0 1px rgba(251,146,60,0.16),0 8px 26px rgba(234,88,12,0.14),inset 0 1px 0 rgba(255,255,255,0.85) !important;" +
      "}" +
      ".main-header #cityName,.main-header h2{" +
      "flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" +
      "}" +
      ".main-header .fav-star-btn{" +
      "margin-left:auto !important;flex-shrink:0;" +
      "}" +
      ".main-header." + HEADER_OFFLINE + " #cityName," +
      ".main-header." + HEADER_OFFLINE + " h2{" +
      "color:#9a3412 !important;" +
      "}" +
      ".main-header." + HEADER_OFFLINE + " .fav-star-btn{" +
      "background:rgba(255,255,255,0.55) !important;" +
      "border-color:rgba(251,146,60,0.35) !important;" +
      "}" +
      ".main-header .offline-net-btn{" +
      "display:none;align-items:center;justify-content:center;" +
      "width:0;height:32px;margin:0;padding:0;border:none;border-radius:10px;" +
      "background:rgba(255,255,255,0.55);color:#c2410c;" +
      "opacity:0;transform:scale(0.5);flex-shrink:0;" +
      "cursor:pointer;-webkit-user-select:none;user-select:none;" +
      "touch-action:manipulation;" +
      "transition:width .4s cubic-bezier(.16,1.2,.3,1),opacity .35s ease,transform .4s cubic-bezier(.16,1.3,.3,1),margin .35s ease,background .2s ease;" +
      "}" +
      ".main-header." + HEADER_OFFLINE + " .offline-net-btn{" +
      "display:inline-flex;width:32px;margin-left:8px;opacity:1;transform:scale(1);" +
      "border:1px solid rgba(251,146,60,0.35);" +
      "box-shadow:inset 0 1px 0 rgba(255,255,255,0.7);" +
      "}" +
      ".main-header .offline-net-btn:active{" +
      "background:rgba(254,215,170,0.85);transform:scale(0.92);" +
      "}" +
      ".main-header .offline-net-btn svg{display:block;width:17px;height:17px;pointer-events:none;}" +
      ".main-header.is-net-leaving{overflow:visible !important;}" +
      ".main-header.is-net-leaving .offline-net-btn{" +
      "position:relative;z-index:3;pointer-events:none;" +
      "animation:netSlideOut .38s cubic-bezier(.4,0,1,1) forwards !important;" +
      "}" +
      "@keyframes netSlideOut{" +
      "0%{opacity:1;transform:translate3d(0,0,0) scale(1)}" +
      "100%{opacity:0;transform:translate3d(36px,0,0) scale(.92)}" +
      "}" +
      ".main-header .offline-island-detail{" +
      "display:block;box-sizing:border-box;order:10;" +
      "flex:0 0 0;width:0;min-width:0;max-width:0;" +
      "max-height:0;opacity:0;overflow:hidden;" +
      "margin:0;padding:0;border:0 solid transparent;" +
      "font-size:11px;font-weight:700;color:#c2410c;line-height:1.35;" +
      "pointer-events:none;" +
      "transition:max-height .28s ease,opacity .22s ease,margin .28s ease,padding .28s ease;" +
      "}" +
      ".main-header." + HEADER_DETAIL + "{" +
      "flex-wrap:wrap !important;" +
      "padding-bottom:10px !important;" +
      "}" +
      ".main-header." + HEADER_DETAIL + " .offline-island-detail{" +
      "flex:1 1 100%;width:100%;min-width:100%;max-width:100%;" +
      "max-height:52px;opacity:1;" +
      "margin-top:8px;padding-top:8px;" +
      "border-top:1px solid rgba(251,146,60,0.28);" +
      "pointer-events:auto;" +
      "}" +
      ".main-header .offline-island-detail .od-title{font-size:12px;}" +
      ".main-header .offline-island-detail .od-sub{font-size:11px;font-weight:600;opacity:.95;margin-top:1px;}" +
      ".main-header.is-island-pulse{animation:islandPulse .45s ease both;}" +
      "@keyframes islandPulse{0%,100%{transform:translateZ(0)}50%{transform:translateZ(0) scale(1.01)}}" +
      ".main-header.is-offline-fold .offline-island-detail{" +
      "max-height:0 !important;opacity:0 !important;" +
      "margin-top:0 !important;padding-top:0 !important;" +
      "border-top-color:transparent !important;" +
      "}" +
      "@media (prefers-reduced-motion:reduce){" +
      ".main-header .offline-island-detail{transition:none !important;}" +
      ".main-header.is-island-pulse{animation:none !important;}" +
      "}";
    document.head.appendChild(s);
  }

  function headerEl() {
    return document.querySelector(".main-header");
  }

  function ageHint() {
    try {
      var raw = localStorage.getItem("mapsky_offline_weather_bundle_v1");
      if (!raw) return "上次備份資料";
      var bundle = JSON.parse(raw);
      if (!bundle || !bundle.savedAt) return "上次備份資料";
      var mins = Math.max(0, Math.round((Date.now() - bundle.savedAt) / 60000));
      var age;
      if (mins < 1) age = "剛剛";
      else if (mins < 60) age = mins + " 分鐘前";
      else if (mins < 48 * 60) age = Math.round(mins / 60) + " 小時前";
      else age = Math.round(mins / 1440) + " 天前";
      return age + "的備份資料";
    } catch (e) {
      return "上次備份資料";
    }
  }

  function ensureLayout() {
    var h = headerEl();
    if (!h) return null;

    var star = h.querySelector(".fav-star-btn");
    if (star) {
      star.style.marginLeft = "auto";
      star.style.flexShrink = "0";
    }

    var btn = h.querySelector(".offline-net-btn");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "offline-net-btn";
      btn.setAttribute("aria-label", "網路狀態，長按查看詳情");
      btn.innerHTML = WIFI_ICON;
      if (star) h.insertBefore(btn, star);
      else h.appendChild(btn);
    } else if (star && btn.nextSibling !== star) {
      h.insertBefore(btn, star);
    }

    var detail = h.querySelector(".offline-island-detail");
    if (!detail) {
      detail = document.createElement("div");
      detail.className = "offline-island-detail";
      detail.innerHTML =
        '<div class="od-title">網路連線不穩定</div>' +
        '<div class="od-sub">顯示上次備份資料</div>';
      h.appendChild(detail);
    }

    bindLongPress(btn, h, detail);

    h.style.display = "flex";
    h.style.alignItems = "center";
    return btn;
  }

  function showDetailOnIsland(h, detail) {
    if (!h || !detail) return;
    var sub = detail.querySelector(".od-sub");
    if (sub) sub.textContent = "顯示 " + ageHint();
    h.classList.remove("is-offline-fold");
    if (!h.classList.contains(HEADER_DETAIL)) {
      h.classList.add(HEADER_DETAIL);
    }
    if (detailHideTimer) clearTimeout(detailHideTimer);
    detailHideTimer = setTimeout(function () {
      hideDetail(h, true);
    }, 3200);
  }

  function hideDetail(h, animated) {
    if (detailHideTimer) {
      clearTimeout(detailHideTimer);
      detailHideTimer = null;
    }
    if (!h) return;
    if (!h.classList.contains(HEADER_DETAIL)) {
      h.classList.remove("is-offline-fold");
      return;
    }
    var detail = h.querySelector(".offline-island-detail");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animated || !detail || reduce) {
      h.classList.remove(HEADER_DETAIL);
      h.classList.remove("is-offline-fold");
      return;
    }
    h.classList.add("is-offline-fold");
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      detail.removeEventListener("transitionend", onEnd);
      h.classList.remove(HEADER_DETAIL);
      h.classList.remove("is-offline-fold");
    }
    function onEnd(ev) {
      if (ev && ev.target !== detail) return;
      if (ev && ev.propertyName && ev.propertyName !== "max-height" && ev.propertyName !== "opacity") return;
      finish();
    }
    detail.addEventListener("transitionend", onEnd);
    setTimeout(finish, 320);
  }

  function bindLongPress(btn, h, detail) {
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
        showDetailOnIsland(h, detail);
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
    var btn = ensureLayout();
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
          left: cR.right + 8,
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
    ensureLayout();
    h.classList.add(HEADER_OFFLINE);
    h.classList.remove("is-island-pulse");
    requestAnimationFrame(function () {
      h.classList.add("is-island-pulse");
      setTimeout(function () {
        h.classList.remove("is-island-pulse");
      }, 480);
    });
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
    if (!h) return;
    hideDetail(h, true);
    h.classList.remove("is-island-pulse");
    if (!h.classList.contains(HEADER_OFFLINE)) return;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || h.classList.contains("is-net-leaving")) {
      h.classList.remove("is-net-leaving");
      h.classList.remove(HEADER_OFFLINE);
      return;
    }
    h.classList.add("is-net-leaving");
    var btn = h.querySelector(".offline-net-btn");
    var done = false;
    function finish(ev) {
      if (ev && ev.animationName && ev.animationName !== "netSlideOut") return;
      if (done) return;
      done = true;
      if (btn) btn.removeEventListener("animationend", finish);
      h.classList.remove("is-net-leaving");
      h.classList.remove(HEADER_OFFLINE);
    }
    if (btn) btn.addEventListener("animationend", finish);
    setTimeout(finish, 480);
  }

  function boot() {
    injectCss();
    ensureBanner();
    setTimeout(ensureLayout, 400);
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
