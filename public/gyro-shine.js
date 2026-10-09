/* MAPSKY_GYRO_SHIM_V7 — direct style writes (WebKit conic-gradient CSS var bug) */
(function mapskyGyroV7() {
  if (window.__mapskyGyroV7) return;
  window.__mapskyGyroV7 = true;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function injectCss() {
    if (document.getElementById("mapsky-gyro-shine-css")) return;
    var s = document.createElement("style");
    s.id = "mapsky-gyro-shine-css";
    s.textContent =
      ".current-card.has-gyro-tilt{" +
      "position:relative !important;" +
      "overflow:visible !important;" +
      "isolation:isolate !important;" +
      "will-change:transform !important;" +
      "}" +
      ".current-card.has-gyro-tilt .gyro-color-rim{" +
      "pointer-events:none !important;" +
      "position:absolute !important;" +
      "left:-3px !important;right:-3px !important;top:-3px !important;bottom:-3px !important;" +
      "border-radius:25px !important;" +
      "z-index:0 !important;" +
      "opacity:1 !important;" +
      "}" +
      ".current-card.has-gyro-tilt .gyro-shine-line{" +
      "pointer-events:none !important;position:absolute !important;" +
      "inset:0 !important;z-index:6 !important;border-radius:inherit !important;" +
      "mix-blend-mode:soft-light !important;" +
      "}" +
      ".current-card.has-gyro-tilt > *:not(.gyro-color-rim):not(.gyro-shine-line){" +
      "position:relative !important;z-index:5 !important;" +
      "}";
    document.head.appendChild(s);
  }

  function el(tag, cls) {
    var n = document.createElement(tag);
    n.className = cls;
    n.setAttribute("aria-hidden", "true");
    return n;
  }

  function boot() {
    injectCss();
    var card = document.querySelector(".current-card");
    if (!card) {
      setTimeout(boot, 250);
      return;
    }

    card.classList.add("has-gyro-tilt");
    try {
      var p = card.parentElement;
      if (p) p.style.overflow = "visible";
    } catch (e) {}

    var rim = card.querySelector(".gyro-color-rim");
    if (!rim) {
      rim = el("div", "gyro-color-rim");
      card.insertBefore(rim, card.firstChild);
    }
    var shine = card.querySelector(".gyro-shine-line");
    if (!shine) {
      shine = el("div", "gyro-shine-line");
      card.insertBefore(shine, rim.nextSibling);
    }

    var enabled = false;
    var targetX = 50, targetY = 20, targetTiltX = 0, targetTiltY = 0, targetRim = 0;
    var curX = 50, curY = 20, curTiltX = 0, curTiltY = 0, curRim = 0;
    var idle = 0;

    function paint() {
      idle = (idle + 2.4) % 360;
      var aim = (targetRim + idle) % 360;

      curX += (targetX - curX) * 0.55;
      curY += (targetY - curY) * 0.55;
      curTiltX += (targetTiltX - curTiltX) * 0.55;
      curTiltY += (targetTiltY - curTiltY) * 0.55;
      var d = aim - curRim;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      curRim += d * 0.5;

      /* DIRECT style — WebKit often ignores CSS-var updates inside conic-gradient */
      rim.style.background =
        "conic-gradient(from " + curRim.toFixed(1) + "deg," +
        "#22d3ee 0deg,#818cf8 72deg,#f472b6 144deg,#38bdf8 216deg,#a78bfa 288deg,#22d3ee 360deg)";

      card.style.transform =
        "perspective(900px) rotateX(" + curTiltX.toFixed(2) + "deg) rotateY(" + curTiltY.toFixed(2) + "deg)";

      shine.style.background =
        "radial-gradient(120% 80% at " + curX.toFixed(1) + "% " + curY.toFixed(1) + "%," +
        "rgba(255,255,255,0.7) 0%,rgba(255,255,255,0.15) 30%,transparent 58%)";

      requestAnimationFrame(paint);
    }

    function onOrient(e) {
      var g = typeof e.gamma === "number" ? e.gamma : 0;
      var b = typeof e.beta === "number" ? e.beta : 0;
      var a = typeof e.alpha === "number" ? e.alpha : 0;
      targetX = clamp(50 + g * 3.5, 2, 98);
      targetY = clamp(18 + (b - 40) * 1.2, 2, 90);
      targetTiltY = clamp(g * 0.5, -16, 16);
      targetTiltX = clamp(-(b - 40) * 0.28, -14, 14);
      targetRim = (a * 2.2 + g * 10 + (b - 40) * 3.5) % 360;
    }

    function onMotion(e) {
      try {
        var acc = e.accelerationIncludingGravity || e.acceleration;
        if (!acc) return;
        var x = acc.x || 0, y = acc.y || 0;
        targetX = clamp(50 + x * 14, 2, 98);
        targetY = clamp(22 - y * 8, 2, 90);
        targetTiltY = clamp(x * 1.6, -16, 16);
        targetTiltX = clamp(y * 1.1, -14, 14);
        targetRim = (targetRim + x * 20) % 360;
      } catch (err) {}
    }

    function startListeners() {
      if (enabled) return;
      enabled = true;
      window.addEventListener("deviceorientation", onOrient, true);
      window.addEventListener("deviceorientationabsolute", onOrient, true);
      window.addEventListener("devicemotion", onMotion, true);
    }

    async function requestPerm() {
      try {
        if (window.DeviceOrientationEvent &&
            typeof DeviceOrientationEvent.requestPermission === "function") {
          var st = await DeviceOrientationEvent.requestPermission();
          if (st === "granted") startListeners();
        } else {
          startListeners();
        }
      } catch (e) { startListeners(); }
      try {
        if (window.DeviceMotionEvent &&
            typeof DeviceMotionEvent.requestPermission === "function") {
          await DeviceMotionEvent.requestPermission();
        }
      } catch (e) {}
      startListeners();
    }

    /* for native WKWebView: call after user allows motion */
    window.mapskyRequestMotion = requestPerm;
    window.mapskyStartGyro = startListeners;

    document.addEventListener("pointerdown", function () { requestPerm(); }, { once: true, capture: true });
    document.addEventListener("touchstart", function () { requestPerm(); }, { once: true, capture: true });

    card.addEventListener("pointermove", function (e) {
      var r = card.getBoundingClientRect();
      if (!r.width) return;
      var x = ((e.clientX - r.left) / r.width) * 100;
      var y = ((e.clientY - r.top) / r.height) * 100;
      targetX = clamp(x, 2, 98);
      targetY = clamp(y, 2, 90);
      targetTiltY = clamp((x - 50) * 0.32, -16, 16);
      targetTiltX = clamp((y - 40) * -0.26, -14, 14);
      targetRim = ((x - 50) * 9 + (y - 50) * 4.5 + 360) % 360;
    }, { passive: true });

    try {
      if (!(window.DeviceOrientationEvent &&
            typeof DeviceOrientationEvent.requestPermission === "function")) {
        startListeners();
      }
    } catch (e) { startListeners(); }

    setTimeout(function () { try { startListeners(); } catch (e) {} }, 800);
    requestAnimationFrame(paint);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 150); });
  } else {
    setTimeout(boot, 150);
  }
})();
