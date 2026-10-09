/* MAPSKY_GYRO_SHIM_V9 — rest still, tilt only while the phone tilts.
   renderer.js owns this when it loads; this file is the fallback. */
(function mapskyGyroV9() {
  if (window.__mapskyGyroV9) return;
  window.__mapskyGyroV9 = true;
  if (window.__mapskyGyroOwned) return;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  const DEAD = 4.5;
  const MAX = 16;

  function boot() {
    if (window.__mapskyGyroOwned) return;
    var card = document.querySelector(".current-card");
    if (!card) { setTimeout(boot, 250); return; }
    if (window.__mapskyGyroOwned) return;
    window.__mapskyGyroOwned = "shim";
    card.classList.add("has-gyro-tilt", "is-gyro-rest");

    var baseGamma = null, baseBeta = null;
    var targetX = 0, targetY = 0, curX = 0, curY = 0;
    var running = false, raf = 0;

    function paint() {
      var idle = Math.abs(targetX) < 0.04 && Math.abs(targetY) < 0.04 &&
        Math.abs(curX) < 0.08 && Math.abs(curY) < 0.08;
      if (idle) {
        curX = 0; curY = 0;
        card.classList.remove("is-gyro-live");
        card.classList.add("is-gyro-rest");
        card.style.setProperty("--tilt-x", "0deg");
        card.style.setProperty("--tilt-y", "0deg");
        running = false;
        return;
      }
      card.classList.add("is-gyro-live");
      card.classList.remove("is-gyro-rest");
      card.style.setProperty("--tilt-x", curX.toFixed(3) + "deg");
      card.style.setProperty("--tilt-y", curY.toFixed(3) + "deg");
    }
    function tick() {
      curX += (targetX - curX) * 0.22;
      curY += (targetY - curY) * 0.22;
      paint();
      if (running) raf = requestAnimationFrame(tick);
    }
    function kick() { if (!running) { running = true; raf = requestAnimationFrame(tick); } }
    function aim(x, y) { targetX = x; targetY = y; kick(); }

    function onOrient(e) {
      var g = typeof e.gamma === "number" ? e.gamma : 0;
      var b = typeof e.beta === "number" ? e.beta : 0;
      if (baseGamma == null) { baseGamma = g; baseBeta = b; return; }
      var dg = g - baseGamma, db = b - baseBeta;
      if (Math.hypot(dg, db) < DEAD) {
        baseGamma = g; baseBeta = b;
        aim(0, 0);
        return;
      }
      aim(clamp(-db * 0.55, -MAX, MAX), clamp(dg * 0.62, -MAX, MAX));
    }
    function start() {
      window.addEventListener("deviceorientation", onOrient, true);
    }
    function requestPerm() {
      try {
        if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
          DeviceOrientationEvent.requestPermission().then(function (st) {
            if (st === "granted") start();
          }).catch(function () {});
          return;
        }
      } catch (e) {}
      start();
    }
    document.addEventListener("pointerdown", function () { requestPerm(); }, { once: true, capture: true });
    try {
      if (!(window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function")) start();
    } catch (e) { start(); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 400); });
  else setTimeout(boot, 400);
})();
