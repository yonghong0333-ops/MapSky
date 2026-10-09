#!/usr/bin/env python3
"""Boot orbit: spinning up = continuous line; spinning down = dots."""
from pathlib import Path
import re

html_path = Path("public/index.html")
html = html_path.read_text(encoding="utf-8")

new_critical = '''  .login-gate-boot-orbit-ring {
    display: none !important;
  }
  .login-gate-boot-orbit-dots {
    position: absolute !important;
    inset: 0 !important;
    pointer-events: none !important;
  }
  .login-gate-boot-orbit-dots svg {
    width: 248px !important;
    height: 248px !important;
    overflow: visible !important;
    transform-origin: 50% 50% !important;
    /* 0→50%：往上轉（順時針一圈）＝線；50→100%：往下轉（逆時針回）＝點 */
    animation: criticalBootSpinUpDown 3.2s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite !important;
  }
  .login-gate-boot-orbit-dots .boot-orbit-path {
    fill: none !important;
    stroke: #2563eb !important;
    stroke-linecap: round !important;
    filter: drop-shadow(0 1px 2px rgba(37, 99, 235, 0.35)) !important;
    animation: criticalBootLineUpDotsDown 3.2s ease-in-out infinite !important;
  }
  @keyframes criticalBootSpinUpDown {
    0%   { transform: rotate(0deg); }
    45%  { transform: rotate(360deg); }
    50%  { transform: rotate(360deg); }
    95%  { transform: rotate(0deg); }
    100% { transform: rotate(0deg); }
  }
  @keyframes criticalBootLineUpDotsDown {
    /* 往上轉 → 線 */
    0%, 8% {
      stroke-dasharray: 0.01 52.36;
      stroke-width: 12;
    }
    18%, 45% {
      stroke-dasharray: 628.3 0;
      stroke-width: 5;
    }
    /* 換向緩衝 */
    50%, 58% {
      stroke-dasharray: 628.3 0;
      stroke-width: 5;
    }
    /* 往下轉 → 點 */
    68%, 100% {
      stroke-dasharray: 0.01 52.36;
      stroke-width: 12;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .login-gate-boot-orbit-dots svg,
    .login-gate-boot-orbit-dots .boot-orbit-path { animation: none !important; }
  }'''

# Replace critical boot orbit CSS block
m = re.search(
    r"  \.login-gate-boot-orbit-ring \{[\s\S]*?@media \(prefers-reduced-motion: reduce\) \{\s*\.login-gate-boot-orbit-dots svg,[\s\S]*?\}",
    html,
)
if not m:
    m = re.search(
        r"  \.login-gate-boot-orbit-ring \{[\s\S]*?@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n  \}",
        html,
    )
if not m:
    raise SystemExit("critical orbit block not found")
html = html[: m.start()] + new_critical + html[m.end() :]
print("critical ok")

# Ensure SVG is path circle not 12 dots
if 'class="boot-orbit-path"' not in html:
    m2 = re.search(
        r'<span class="login-gate-boot-orbit-dots"[^>]*>\s*<svg[\s\S]*?</svg>\s*</span>',
        html,
    )
    if not m2:
        raise SystemExit("svg not found")
    new_svg = (
        '<span class="login-gate-boot-orbit-dots" aria-hidden="true">'
        '<svg viewBox="0 0 248 248" width="248" height="248">'
        '<circle class="boot-orbit-path" cx="124" cy="124" r="100" '
        'pathLength="628.3" fill="none"/>'
        "</svg></span>"
    )
    html = html[: m2.start()] + new_svg + html[m2.end() :]
    print("svg fixed")
else:
    print("svg ok")

html_path.write_text(html, encoding="utf-8")

# style.css
css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")

new_css = '''/* BOOT_ORBIT_V6 — 往上轉＝線，往下轉＝點 */
.login-gate-boot-orbit-wrap {
  position: relative;
  width: 248px;
  height: 248px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.login-gate-boot-orbit-ring {
  display: none;
}
.login-gate-boot-orbit-dots {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.login-gate-boot-orbit-dots svg {
  width: 248px;
  height: 248px;
  overflow: visible;
  transform-origin: 50% 50%;
  animation: login-boot-spin-up-down 3.2s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
}
.login-gate-boot-orbit-dots .boot-orbit-path,
.login-gate-boot-orbit-dots circle.boot-orbit-path {
  fill: none;
  stroke: #2563eb;
  stroke-linecap: round;
  filter: drop-shadow(0 1px 2px rgba(37, 99, 235, 0.35));
  animation: login-boot-line-up-dots-down 3.2s ease-in-out infinite;
}
.login-gate-boot-orbit-wrap .login-gate-boot-weather {
  width: 96px;
  height: 96px;
  z-index: 1;
}
@keyframes login-boot-spin-up-down {
  0%   { transform: rotate(0deg); }
  45%  { transform: rotate(360deg); }
  50%  { transform: rotate(360deg); }
  95%  { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}
@keyframes login-boot-line-up-dots-down {
  0%, 8% {
    stroke-dasharray: 0.01 52.36;
    stroke-width: 12;
  }
  18%, 45% {
    stroke-dasharray: 628.3 0;
    stroke-width: 5;
  }
  50%, 58% {
    stroke-dasharray: 628.3 0;
    stroke-width: 5;
  }
  68%, 100% {
    stroke-dasharray: 0.01 52.36;
    stroke-width: 12;
  }
}
'''

m = re.search(
    r"/\* BOOT_ORBIT_DOTS_V[45][\s\S]*?@keyframes login-boot-dots-to-line \{[\s\S]*?\}\n",
    css,
)
if not m:
    m = re.search(
        r"/\* BOOT_ORBIT[\s\S]*?@keyframes login-boot-orbit-spin \{[\s\S]*?\}\n",
        css,
    )
if m:
    css = css[: m.start()] + new_css + css[m.end() :]
    print("style replace ok")
elif "login-boot-line-up-dots-down" in css:
    print("style already")
else:
    css += "\n" + new_css
    print("style append")

css_path.write_text(css, encoding="utf-8")
print("DONE")
