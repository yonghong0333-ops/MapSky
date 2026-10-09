/* MAPSKY_GYRO_SHIM_V6 — always-on idle rim spin + gyro boost */
(function mapskyGyroInline() {
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function injectCss() {
    if (document.getElementById("mapsky-gyro-shine-css")) return;
    var s = document.createElement("style");
    s.id = "mapsky-gyro-shine-css";
    s.textContent =
      ".current-card.has-gyro-tilt{" +
      "--shine-x:50%;--shine-y:18%;--tilt-x:0deg;--tilt-y:0deg;--rim-angle:0deg;" +
      "position:relative !important;" +
      "transform:perspective(1000px) rotateX(var(--tilt-x)) rotateY(var(--tilt-y)) !important;" +
      "transform-style:preserve-3d !important;" +
      "will-change:transform;" +
      "isolation:isolate;" +
      "overflow:visible !important;" +
      "}" +
      ".current-card.has-gyro-tilt .gyro-color-rim{" +
      "pointer-events:none !important;position:absolute !important;" +
      "inset:-2.5px !important;z-index:0 !important;" +
      "border-radius:inherit !important;" +
      "background:conic-gradient(from var(--rim-angle)," +
      "#38bdf8 0deg," +
      "#a78bfa 90deg," +
      "#f472b6 180deg," +
      "#22d3ee 270deg," +
      "#38bdf8 360deg) !important;" +
      "opacity:0.95 !important;" +
      "}" +
      ".current-card.has-gyro-tilt .gyro-color-rim::after{" +
      "content:'' !important;position:absolute !important;inset:-4px !important;" +
      "border-radius:inherit !important;" +
      "background:conic-gradient(from var(--rim-angle)," +
      "rgba(56,189,248,0.45)," +
      "rgba(167,139,250,0.35)," +
      "rgba(244,114,182,0.3)," +
      "rgba(34,211,238,0.4)," +
      "rgba(56,189,248,0.45)) !important;" +
      "filter:blur(8px) !important;opacity:0.75 !important;z-index:-1 !important;" +
      "}" +
      ".current-card.has-gyro-tilt .gyro-shine-line{" +
      "pointer-events:none !important;position:absolute !important;" +
      "inset:0 !important;z-index:4 !important;border-radius:inherit !important;" +
      "background:radial-gradient(140% 90% at var(--shine-x) var(--shine-y)," +
      "rgba(255,255,255,0.6) 0%,rgba(255,255,255,0.15) 28%,transparent 55%) !important;" +
      "mix-blend-mode:soft-light !important;opacity:0.95 !important;" +
      "}" +
      ".current-card.has-gyro-tilt > *:not(.gyro-color-rim):not(.gyro-shine-line){" +
      "position:relative !important;z-index:2 !important;" +
      "}" +
      ".current-card.has-gyro-tilt::before{" +
      "z-index:1 !important;" +
      "}" +
      "@media (prefers-reduced-motion:reduce){" +
      ".current-card.has-gyro-tilt{transform:none !important;}" +
      ".current-card.has-gyro-tilt .gyro-color-rim{opacity:0.4 !important;}" +
      "}";
    document.head.appendChild(s);
  }

  function ensureChild(card, className, asFirst) {
    var el = card.querySelector("." + className);
    if (el) return el;
    el = document.createElement("div");
    el.className = className;
    el.setAttribute("aria-hidden", "true");
    if (asFirst) card.insertBefore(el, card.firstChild);
    else card.appendChild(el);
    return el;
  }

  function boot() {
    injectCss();
    var card = document.querySelector(".current-card");
    if (!card) {
      setTimeout(boot, 300);
      return;
    }

    card.classList.add("has-gyro-tilt");
    ensureChild(card, "gyro-color-rim", true);
    ensureChild(card, "gyro-shine-line", true);

    var enabled = false;
    var raf = 0;
    var targetX = 50, targetY = 18, targetTiltX = 0, targetTiltY = 0, targetRim = 0;
    var curX = 50, curY = 18, curTiltX = 0, curTiltY = 0, curRim = 0;
    var idle = 0;

    function tick() {
      idle = (idle + 1.8) % 360;
      var aimRim = (targetRim + idle) % 360;

      curX += (targetX - curX) * 0.5;
      curY += (targetY - curY) * 0.5;
      curTiltX += (targetTiltX - curTiltX) * 0.5;
      curTiltY += (targetTiltY - curTiltY) * 0.5;
      var d = aimRim - curRim;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      curRim += d * 0.45;

      card.style.setProperty("--shine-x", curX.toFixed(2) + "%");
      card.style.setProperty("--shine-y", curY.toFixed(2) + "%");
      card.style.setProperty("--tilt-x", curTiltX.toFixed(3) + "deg");
      card.style.setProperty("--tilt-y", curTiltY.toFixed(3) + "deg");
      card.style.setProperty("--rim-angle", curRim.toFixed(2) + "deg");
      raf = requestAnimationFrame(tick);
    }

    function onOrient(e) {
      var gamma = typeof e.gamma === "number" ? e.gamma : 0;
      var beta = typeof e.beta === "number" ? e.beta : 0;
      var alpha = typeof e.alpha === "number" ? e.alpha : 0;
      targetX = clamp(50 + gamma * 3.5, 2, 98);
      targetY = clamp(20 + (beta - 40) * 1.2, 2, 85);
      targetTiltY = clamp(gamma * 0.45, -14, 14);
      targetTiltX = clamp(-(beta - 40) * 0.25, -12, 12);
      targetRim = (alpha * 2 + gamma * 9 + (beta - 40) * 3) % 360;
    }

    function onMotion(e) {
      try {
        var a = e.accelerationIncludingGravity || e.acceleration;
        if (!a) return;
        var x = typeof a.x === "number" ? a.x : 0;
        var y = typeof a.y === "number" ? a.y : 0;
        targetX = clamp(50 + x * 14, 2, 98);
        targetY = clamp(22 - y * 8, 2, 85);
        targetTiltY = clamp(x * 1.5, -14, 14);
        targetTiltX = clamp(y * 1.0, -12, 12);
        targetRim = (targetRim + x * 18) % 360;
      } catch (err) {}
    }

    function startListeners() {
      if (enabled) return;
      enabled = true;
      window.addEventListener("deviceorientation", onOrient, { passive: true });
      window.addEventListener("deviceorientationabsolute", onOrient, { passive: true });
      window.addEventListener("devicemotion", onMotion, { passive: true });
    }

    async function requestPerm() {
      try {
        if (typeof DeviceOrientationEvent !== "undefined" &&
            typeof DeviceOrientationEvent.requestPermission === "function") {
          var st = await DeviceOrientationEvent.requestPermission();
          if (st === "granted") startListeners();
        } else {
          startListeners();
        }
      } catch (e) {
        startListeners();
      }
      try {
        if (typeof DeviceMotionEvent !== "undefined" &&
            typeof DeviceMotionEvent.requestPermission === "function") {
          await DeviceMotionEvent.requestPermission();
        }
      } catch (e) {}
      startListeners();
    }

    document.addEventListener("pointerdown", function () { requestPerm(); }, { once: true, passive: true });
    document.addEventListener("touchstart", function () { requestPerm(); }, { once: true, passive: true });

    card.addEventListener("pointermove", function (e) {
      var rect = card.getBoundingClientRect();
      if (!rect.width) return;
      var x = ((e.clientX - rect.left) / rect.width) * 100;
      var y = ((e.clientY - rect.top) / rect.height) * 100;
      targetX = clamp(x, 2, 98);
      targetY = clamp(y, 2, 85);
      targetTiltY = clamp((x - 50) * 0.3, -14, 14);
      targetTiltX = clamp((y - 40) * -0.24, -12, 12);
      targetRim = ((x - 50) * 8 + (y - 50) * 4 + 360) % 360;
    }, { passive: true });

    try {
      if (!(typeof DeviceOrientationEvent !== "undefined" &&
            typeof DeviceOrientationEvent.requestPermission === "function")) {
        startListeners();
      }
    } catch (e) {
      startListeners();
    }

    if (!raf) raf = requestAnimationFrame(tick);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 200); });
  } else {
    setTimeout(boot, 200);
  }
})();
