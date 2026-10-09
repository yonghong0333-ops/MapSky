/* MAPSKY_GYRO_SHIM_V4 — tilt shine + soft rainbow rim that orbits with gyro */
(function mapskyGyroShimV4() {
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function injectCss() {
    if (document.getElementById("mapsky-gyro-shine-css")) return;
    var s = document.createElement("style");
    s.id = "mapsky-gyro-shine-css";
    s.textContent =
      ".current-card.has-gyro-tilt{" +
      "--shine-x:50%;--shine-y:18%;--tilt-x:0deg;--tilt-y:0deg;--rim-angle:0deg;" +
      "transform:perspective(1000px) rotateX(var(--tilt-x)) rotateY(var(--tilt-y));" +
      "transform-style:preserve-3d;will-change:transform;" +
      "isolation:isolate;" +
      "}" +
      ".current-card.has-gyro-tilt .gyro-color-rim{" +
      "pointer-events:none;position:absolute;inset:-1.5px;z-index:6;" +
      "border-radius:inherit;padding:1.5px;" +
      "background:conic-gradient(from var(--rim-angle)," +
      "rgba(56,189,248,0.85)," +
      "rgba(167,139,250,0.75)," +
      "rgba(244,114,182,0.55)," +
      "rgba(125,211,252,0.8)," +
      "rgba(56,189,248,0.85));" +
      "-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);" +
      "-webkit-mask-composite:xor;" +
      "mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);" +
      "mask-composite:exclude;" +
      "opacity:0.72;" +
      "filter:saturate(1.05);" +
      "}" +
      ".current-card.has-gyro-tilt .gyro-color-rim::after{" +
      "content:'';position:absolute;inset:-3px;border-radius:inherit;" +
      "background:conic-gradient(from var(--rim-angle)," +
      "rgba(56,189,248,0.25)," +
      "rgba(167,139,250,0.18)," +
      "rgba(244,114,182,0.12)," +
      "rgba(125,211,252,0.2)," +
      "rgba(56,189,248,0.25));" +
      "filter:blur(6px);opacity:0.55;z-index:-1;" +
      "}" +
      ".current-card.has-gyro-tilt .gyro-shine-line{" +
      "pointer-events:none;position:absolute;inset:0;z-index:4;border-radius:inherit;" +
      "background:radial-gradient(140% 90% at var(--shine-x) var(--shine-y)," +
      "rgba(255,255,255,0.55) 0%,rgba(255,255,255,0.14) 26%," +
      "rgba(186,230,253,0.06) 42%,transparent 58%);" +
      "mix-blend-mode:soft-light;opacity:0.9;" +
      "}" +
      ".current-card.has-gyro-tilt>*:not(.gyro-shine-line):not(.gyro-color-rim){" +
      "position:relative;z-index:5;" +
      "}" +
      "@media (prefers-reduced-motion:reduce){" +
      ".current-card.has-gyro-tilt{transform:none!important;}" +
      ".current-card.has-gyro-tilt .gyro-shine-line{opacity:0.2;}" +
      ".current-card.has-gyro-tilt .gyro-color-rim{opacity:0.35;}" +
      ".current-card.has-gyro-tilt .gyro-color-rim::after{display:none;}" +
      "}";
    document.head.appendChild(s);
  }

  function ensureChild(card, className) {
    var el = card.querySelector("." + className);
    if (el) return el;
    el = document.createElement("div");
    el.className = className;
    el.setAttribute("aria-hidden", "true");
    card.insertBefore(el, card.firstChild);
    return el;
  }

  function boot() {
    injectCss();
    var card = document.querySelector(".current-card");
    if (!card) {
      setTimeout(boot, 400);
      return;
    }

    if (!card.classList.contains("has-gyro-tilt")) {
      card.classList.add("has-gyro-tilt");
    }
    ensureChild(card, "gyro-color-rim");
    ensureChild(card, "gyro-shine-line");

    var enabled = false;
    var raf = 0;
    var targetX = 50,
      targetY = 18,
      targetTiltX = 0,
      targetTiltY = 0,
      targetRim = 0;
    var curX = 50,
      curY = 18,
      curTiltX = 0,
      curTiltY = 0,
      curRim = 0;

    function tick() {
      curX += (targetX - curX) * 0.18;
      curY += (targetY - curY) * 0.18;
      curTiltX += (targetTiltX - curTiltX) * 0.18;
      curTiltY += (targetTiltY - curTiltY) * 0.18;
      var d = targetRim - curRim;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      curRim += d * 0.12;
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
      targetX = clamp(50 + gamma * 1.5, 5, 95);
      targetY = clamp(20 + (beta - 40) * 0.45, 4, 65);
      targetTiltY = clamp(gamma * 0.16, -8, 8);
      targetTiltX = clamp(-(beta - 40) * 0.08, -6, 6);
      targetRim = (alpha * 0.85 + gamma * 2.2 + (beta - 40) * 0.6) % 360;
    }

    function onMotion(e) {
      try {
        var a = e.accelerationIncludingGravity || e.acceleration;
        if (!a) return;
        var x = typeof a.x === "number" ? a.x : 0;
        var y = typeof a.y === "number" ? a.y : 0;
        targetX = clamp(50 + x * 7, 5, 95);
        targetY = clamp(22 - y * 3.5, 4, 65);
        targetTiltY = clamp(x * 0.7, -8, 8);
        targetTiltX = clamp(y * 0.4, -6, 6);
        targetRim = (targetRim + x * 4) % 360;
      } catch (err) {}
    }

    function startListeners() {
      if (enabled) return;
      enabled = true;
      window.addEventListener("deviceorientation", onOrient, { passive: true });
      window.addEventListener("deviceorientationabsolute", onOrient, { passive: true });
      window.addEventListener("devicemotion", onMotion, { passive: true });
      if (!raf) raf = requestAnimationFrame(tick);
    }

    async function requestPerm() {
      try {
        if (
          typeof DeviceOrientationEvent !== "undefined" &&
          typeof DeviceOrientationEvent.requestPermission === "function"
        ) {
          var st = await DeviceOrientationEvent.requestPermission();
          if (st === "granted") startListeners();
        }
      } catch (e) {}
      try {
        if (
          typeof DeviceMotionEvent !== "undefined" &&
          typeof DeviceMotionEvent.requestPermission === "function"
        ) {
          await DeviceMotionEvent.requestPermission();
        }
      } catch (e) {}
      startListeners();
    }

    var once = function () {
      requestPerm();
    };
    document.addEventListener("pointerdown", once, { once: true, passive: true });
    document.addEventListener("touchstart", once, { once: true, passive: true });

    card.addEventListener(
      "pointermove",
      function (e) {
        var rect = card.getBoundingClientRect();
        if (!rect.width) return;
        var x = ((e.clientX - rect.left) / rect.width) * 100;
        var y = ((e.clientY - rect.top) / rect.height) * 100;
        targetX = clamp(x, 5, 95);
        targetY = clamp(y, 4, 65);
        targetTiltY = clamp((x - 50) * 0.14, -8, 8);
        targetTiltX = clamp((y - 40) * -0.1, -6, 6);
        targetRim = ((x - 50) * 3.6 + (y - 50) * 1.8 + 360) % 360;
        if (!raf) raf = requestAnimationFrame(tick);
      },
      { passive: true }
    );

    try {
      if (
        !(
          typeof DeviceOrientationEvent !== "undefined" &&
          typeof DeviceOrientationEvent.requestPermission === "function"
        )
      ) {
        startListeners();
      }
    } catch (e) {}

    if (!raf) raf = requestAnimationFrame(tick);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(boot, 300);
    });
  } else {
    setTimeout(boot, 300);
  }
})();
