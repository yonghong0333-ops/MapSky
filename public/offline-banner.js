/* offline-banner.js — 網路不穩定橘色液態玻璃提示（由上滑下） */
(function () {
  var BANNER_ID = "mapskyOfflineBanner";
  var STYLE_ID = "mapsky-offline-banner-css";
  var hideTimer = null;

  function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
      "#" + BANNER_ID + "{" +
      "position:fixed;left:12px;right:12px;top:calc(10px + env(safe-area-inset-top,0px));" +
      "z-index:100000;padding:12px 14px;border-radius:16px;" +
      "display:flex;align-items:center;gap:10px;" +
      "background:linear-gradient(160deg,rgba(255,247,237,0.92),rgba(255,237,213,0.75) 55%,rgba(254,215,170,0.55));" +
      "border:1px solid rgba(251,146,60,0.55);" +
      "box-shadow:0 0 0 1px rgba(251,146,60,0.18),0 10px 28px rgba(234,88,12,0.18),0 4px 12px rgba(15,23,42,0.08),inset 0 1px 0 rgba(255,255,255,0.75);" +
      "backdrop-filter:blur(24px) saturate(180%);-webkit-backdrop-filter:blur(24px) saturate(180%);" +
      "color:#9a3412;font-size:13px;font-weight:700;line-height:1.35;" +
      "transform:translateY(-120%) scale(0.96);opacity:0;" +
      "transition:transform .42s cubic-bezier(.16,1.15,.3,1),opacity .28s ease-out;" +
      "pointer-events:none;" +
      "}" +
      "#" + BANNER_ID + ".is-visible{" +
      "transform:translateY(0) scale(1);opacity:1;pointer-events:auto;" +
      "}" +
      "#" + BANNER_ID + " .ob-icon{font-size:18px;flex-shrink:0;line-height:1;}" +
      "#" + BANNER_ID + " .ob-text{flex:1;min-width:0;}" +
      "#" + BANNER_ID + " .ob-sub{display:block;margin-top:2px;font-size:11px;font-weight:600;color:#c2410c;opacity:.9;}" +
      "#" + BANNER_ID + " .ob-close{" +
      "flex-shrink:0;width:28px;height:28px;border-radius:50%;border:none;" +
      "background:rgba(154,52,18,0.1);color:#9a3412;font-size:14px;font-weight:700;" +
      "cursor:pointer;display:flex;align-items:center;justify-content:center;" +
      "}" +
      "#" + BANNER_ID + " .ob-close:active{background:rgba(154,52,18,0.2);}";
    document.head.appendChild(s);
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
      '<span class="ob-icon" aria-hidden="true">📡</span>' +
      '<span class="ob-text">' +
      '<span class="ob-main">網路連線不穩定</span>' +
      '<span class="ob-sub">將顯示上次備份的天氣資料</span>' +
      "</span>" +
      '<button type="button" class="ob-close" aria-label="關閉">✕</button>';
    document.body.appendChild(b);
    b.querySelector(".ob-close").addEventListener("click", function () {
      hideBanner(true);
    });
    return b;
  }

  function showBanner(subText) {
    var b = ensureBanner();
    var sub = b.querySelector(".ob-sub");
    if (sub && subText) sub.textContent = subText;
    // force reflow so slide-down always plays
    b.classList.remove("is-visible");
    void b.offsetHeight;
    b.classList.add("is-visible");
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function hideBanner(immediate) {
    var b = document.getElementById(BANNER_ID);
    if (!b) return;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    b.classList.remove("is-visible");
    if (immediate) return;
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

  function onOffline() {
    showBanner(ageHint());
  }

  function onOnline() {
    hideBanner();
  }

  function boot() {
    ensureBanner();
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    // already offline on load
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setTimeout(onOffline, 400);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(boot, 200);
    });
  } else {
    setTimeout(boot, 200);
  }
})();
