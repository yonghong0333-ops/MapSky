/* MAPSKY_GYRO_SHIM_V3 — device tilt drives specular shine + 3D card tilt */
(function mapskyGyroShimV3() {
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function boot() {
    var card = document.querySelector(".current-card");
    if (!card) {
      setTimeout(boot, 400);
      return;
    }

    if (!card.classList.contains("has-gyro-tilt")) {
      card.classList.add("has-gyro-tilt");
    }
    if (!card.querySelector(".gyro-shine-line")) {
      var line = document.createElement("div");
      line.className = "gyro-shine-line";
      line.setAttribute("aria-hidden", "true");
      card.insertBefore(line, card.firstChild);
    }

    var enabled = false;
    var raf = 0;
    var targetX = 50,
      targetY = 18,
      targetTiltX = 0,
      targetTiltY = 0;
    var curX = 50,
      curY = 18,
      curTiltX = 0,
      curTiltY = 0;

    function tick() {
      curX += (targetX - curX) * 0.18;
      curY += (targetY - curY) * 0.18;
      curTiltX += (targetTiltX - curTiltX) * 0.18;
      curTiltY += (targetTiltY - curTiltY) * 0.18;
      card.style.setProperty("--shine-x", curX.toFixed(2) + "%");
      card.style.setProperty("--shine-y", curY.toFixed(2) + "%");
      card.style.setProperty("--tilt-x", curTiltX.toFixed(3) + "deg");
      card.style.setProperty("--tilt-y", curTiltY.toFixed(3) + "deg");
      raf = requestAnimationFrame(tick);
    }

    function onOrient(e) {
      var gamma = typeof e.gamma === "number" ? e.gamma : 0;
      var beta = typeof e.beta === "number" ? e.beta : 0;
      targetX = clamp(50 + gamma * 1.5, 5, 95);
      targetY = clamp(20 + (beta - 40) * 0.45, 4, 65);
      targetTiltY = clamp(gamma * 0.16, -8, 8);
      targetTiltX = clamp(-(beta - 40) * 0.08, -6, 6);
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

    /* Desktop / pointer fallback */
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
