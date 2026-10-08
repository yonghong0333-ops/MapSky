#!/usr/bin/env python3
from pathlib import Path

css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")

if "gyro-glass-shine" in css:
    print("css already")
else:
    css += '''

/* gyro-glass-shine: 高光線隨陀螺儀移動 */
.current-card {
  --shine-x: 50%;
  --shine-y: 18%;
  --shine-angle: -18deg;
  isolation: isolate;
}
.current-card .gyro-shine-layer,
.current-card > .gyro-shine-line {
  pointer-events: none;
}
/* 頂部玻璃高光線（隨 --shine-x 移動） */
.current-card::before {
  content: "";
  position: absolute;
  left: -20%;
  right: -20%;
  top: 0;
  height: 42%;
  border-radius: inherit;
  background: linear-gradient(
    var(--shine-angle, -18deg),
    transparent 0%,
    transparent calc(var(--shine-x) - 18%),
    rgba(255, 255, 255, 0.08) calc(var(--shine-x) - 8%),
    rgba(255, 255, 255, 0.55) var(--shine-x),
    rgba(255, 255, 255, 0.12) calc(var(--shine-x) + 8%),
    transparent calc(var(--shine-x) + 18%),
    transparent 100%
  );
  opacity: 0.85;
  pointer-events: none;
  z-index: 2;
  mix-blend-mode: soft-light;
  transition: none;
}
/* 一條更銳利的高光線 */
.current-card .gyro-shine-line {
  position: absolute;
  top: 10px;
  left: 12px;
  right: 12px;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    transparent calc(var(--shine-x) - 22%),
    rgba(255, 255, 255, 0.25) calc(var(--shine-x) - 10%),
    rgba(255, 255, 255, 0.95) var(--shine-x),
    rgba(255, 255, 255, 0.3) calc(var(--shine-x) + 10%),
    transparent calc(var(--shine-x) + 22%),
    transparent 100%
  );
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.45);
  pointer-events: none;
  z-index: 4;
  opacity: 0.9;
}
/* 整卡輕微傾角（很克制，避免暈） */
.current-card.has-gyro-tilt {
  transform: perspective(900px)
    rotateX(var(--tilt-x, 0deg))
    rotateY(var(--tilt-y, 0deg));
  transform-style: preserve-3d;
}
'''
    css_path.write_text(css, encoding="utf-8")
    print("css ok")

# HTML: inject shine line element inside current-card if missing
html_path = Path("public/index.html")
html = html_path.read_text(encoding="utf-8")
if "gyro-shine-line" in html:
    print("html already")
else:
    html = html.replace(
        '<section class="current-card">',
        '<section class="current-card has-gyro-tilt">\n          <div class="gyro-shine-line" aria-hidden="true"></div>',
        1,
    )
    html_path.write_text(html, encoding="utf-8")
    print("html ok")

# JS
r_path = Path("public/renderer.js")
r = r_path.read_text(encoding="utf-8")
if "initGyroGlassShine" in r:
    print("js already")
else:
    snippet = r'''
// 主天氣卡玻璃高光線：跟隨裝置陀螺儀
(function initGyroGlassShine() {
  const card = document.querySelector(".current-card");
  if (!card) return;

  let enabled = false;
  let raf = 0;
  let targetX = 50;
  let targetY = 18;
  let targetTiltX = 0;
  let targetTiltY = 0;
  let curX = 50;
  let curY = 18;
  let curTiltX = 0;
  let curTiltY = 0;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function tick() {
    curX += (targetX - curX) * 0.12;
    curY += (targetY - curY) * 0.12;
    curTiltX += (targetTiltX - curTiltX) * 0.12;
    curTiltY += (targetTiltY - curTiltY) * 0.12;
    card.style.setProperty("--shine-x", curX.toFixed(2) + "%");
    card.style.setProperty("--shine-y", curY.toFixed(2) + "%");
    card.style.setProperty("--tilt-x", curTiltX.toFixed(3) + "deg");
    card.style.setProperty("--tilt-y", curTiltY.toFixed(3) + "deg");
    card.style.setProperty("--shine-angle", (-12 - (curX - 50) * 0.15).toFixed(2) + "deg");
    raf = requestAnimationFrame(tick);
  }

  function onOrient(e) {
    // gamma: 左右 -90~90；beta: 前後 -180~180
    const gamma = typeof e.gamma === "number" ? e.gamma : 0;
    const beta = typeof e.beta === "number" ? e.beta : 0;
    targetX = clamp(50 + gamma * 0.9, 8, 92);
    targetY = clamp(18 + (beta - 45) * 0.25, 5, 55);
    targetTiltY = clamp(gamma * 0.08, -4, 4);
    targetTiltX = clamp(-(beta - 45) * 0.04, -3, 3);
  }

  function start() {
    if (enabled) return;
    enabled = true;
    window.addEventListener("deviceorientation", onOrient, { passive: true });
    raf = requestAnimationFrame(tick);
  }

  async function tryEnable() {
    try {
      if (typeof DeviceOrientationEvent !== "undefined" &&
          typeof DeviceOrientationEvent.requestPermission === "function") {
        // iOS：需使用者手勢授權；首次點擊卡片時再請求
        const once = async () => {
          try {
            const state = await DeviceOrientationEvent.requestPermission();
            if (state === "granted") start();
          } catch (err) {}
          card.removeEventListener("pointerdown", once);
        };
        card.addEventListener("pointerdown", once, { once: true });
        // 若先前已授權，直接 start 可能無效，仍等手勢較穩
      } else if (typeof window.DeviceOrientationEvent !== "undefined") {
        start();
      }
    } catch (e) {}
  }

  // 非 iOS 直接開；iOS 等第一次點卡片
  tryEnable();
})();
'''
    if "initToolsGlassPress" in r:
        r = r.replace("(function initToolsGlassPress() {", snippet + "\n(function initToolsGlassPress() {", 1)
    else:
        r = r + "\n" + snippet
    r_path.write_text(r, encoding="utf-8")
    print("js ok")

print("DONE")
