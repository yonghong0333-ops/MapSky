#!/usr/bin/env python3
"""Boot loader: blue dots orbit, then morph into a continuous line ring."""
from pathlib import Path
import re

html_path = Path("public/index.html")
html = html_path.read_text(encoding="utf-8")

# --- 1) critical-boot-css: stroke ring that goes dots -> line ---
old_critical_orbit = '''  .login-gate-boot-orbit-ring {
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
    animation: criticalBootSpin 2.6s linear infinite !important;
  }
  .login-gate-boot-orbit-dots circle {
    fill: #2563eb !important;
    stroke: none !important;
    filter: drop-shadow(0 1px 2px rgba(37, 99, 235, 0.35)) !important;
    animation: none !important;
  }
  @keyframes criticalBootSpin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .login-gate-boot-orbit-dots svg,
    .login-gate-boot-orbit-dots circle { animation: none !important; }
  }'''

new_critical_orbit = '''  .login-gate-boot-orbit-ring {
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
    animation: criticalBootSpin 2.8s linear infinite !important;
  }
  /* r=100 → circumference ≈ 628.3；12 等分 ≈ 52.36
     點模式：round cap + 極短 dash = 看起來像圓點
     線模式：dash 拉長接成一圈連續線 */
  .login-gate-boot-orbit-dots .boot-orbit-path {
    fill: none !important;
    stroke: #2563eb !important;
    stroke-width: 12 !important;
    stroke-linecap: round !important;
    stroke-dasharray: 0.01 52.36 !important;
    filter: drop-shadow(0 1px 2px rgba(37, 99, 235, 0.35)) !important;
    animation: criticalBootDotsToLine 2.8s ease-in-out infinite !important;
  }
  @keyframes criticalBootSpin {
    to { transform: rotate(360deg); }
  }
  @keyframes criticalBootDotsToLine {
    0%, 35% {
      stroke-dasharray: 0.01 52.36;
      stroke-width: 12;
    }
    55%, 85% {
      stroke-dasharray: 628.3 0;
      stroke-width: 5;
    }
    100% {
      stroke-dasharray: 0.01 52.36;
      stroke-width: 12;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .login-gate-boot-orbit-dots svg,
    .login-gate-boot-orbit-dots .boot-orbit-path { animation: none !important; }
  }'''

if "criticalBootDotsToLine" in html:
    print("critical css already")
elif old_critical_orbit in html:
    html = html.replace(old_critical_orbit, new_critical_orbit, 1)
    print("critical css ok")
else:
    # softer: replace from orbit-ring through criticalBootSpin block
    m = re.search(
        r"  \.login-gate-boot-orbit-ring \{[\s\S]*?@keyframes criticalBootSpin \{[\s\S]*?\}\s*@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\}",
        html,
    )
    if not m:
        raise SystemExit("critical orbit block not found")
    html = html[: m.start()] + new_critical_orbit + html[m.end() :]
    print("critical css soft ok")

# --- 2) HTML: replace 12 circles with one stroke path circle ---
old_svg = (
    '<span class="login-gate-boot-orbit-dots" aria-hidden="true">'
    '<svg viewBox="0 0 248 248" width="248" height="248">'
    '<circle cx="124.0" cy="24.0" r="7"/>'
    '<circle cx="174.0" cy="37.4" r="7"/>'
    '<circle cx="210.6" cy="74.0" r="7"/>'
    '<circle cx="224.0" cy="124.0" r="7"/>'
    '<circle cx="210.6" cy="174.0" r="7"/>'
    '<circle cx="174.0" cy="210.6" r="7"/>'
    '<circle cx="124.0" cy="224.0" r="7"/>'
    '<circle cx="74.0" cy="210.6" r="7"/>'
    '<circle cx="37.4" cy="174.0" r="7"/>'
    '<circle cx="24.0" cy="124.0" r="7"/>'
    '<circle cx="37.4" cy="74.0" r="7"/>'
    '<circle cx="74.0" cy="37.4" r="7"/>'
    "</svg></span>"
)
new_svg = (
    '<span class="login-gate-boot-orbit-dots" aria-hidden="true">'
    '<svg viewBox="0 0 248 248" width="248" height="248">'
    '<circle class="boot-orbit-path" cx="124" cy="124" r="100" '
    'pathLength="628.3" fill="none"/>'
    "</svg></span>"
)

if 'class="boot-orbit-path"' in html:
    print("svg already")
elif old_svg in html:
    html = html.replace(old_svg, new_svg, 1)
    print("svg exact ok")
else:
    m = re.search(
        r'<span class="login-gate-boot-orbit-dots"[^>]*>\s*<svg[\s\S]*?</svg>\s*</span>',
        html,
    )
    if not m:
        raise SystemExit("orbit-dots svg not found")
    html = html[: m.start()] + new_svg + html[m.end() :]
    print("svg soft ok")

html_path.write_text(html, encoding="utf-8")

# --- 3) style.css BOOT_ORBIT_DOTS section ---
css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")

old_css = '''/* BOOT_ORBIT_DOTS_V4 — visible dots, full rotation */
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
  animation: login-boot-orbit-spin 2.6s linear infinite;
}
.login-gate-boot-orbit-dots circle {
  fill: #2563eb;
  stroke: none;
  filter: drop-shadow(0 1px 2px rgba(37, 99, 235, 0.35));
  animation: none;
}
.login-gate-boot-orbit-wrap .login-gate-boot-weather {
  width: 96px;
  height: 96px;
  z-index: 1;
}
@keyframes login-boot-orbit-spin {
  to { transform: rotate(360deg); }
}'''

new_css = '''/* BOOT_ORBIT_DOTS_V5 — dots spin, then morph into continuous line */
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
  animation: login-boot-orbit-spin 2.8s linear infinite;
}
.login-gate-boot-orbit-dots .boot-orbit-path,
.login-gate-boot-orbit-dots circle.boot-orbit-path {
  fill: none;
  stroke: #2563eb;
  stroke-width: 12;
  stroke-linecap: round;
  stroke-dasharray: 0.01 52.36;
  filter: drop-shadow(0 1px 2px rgba(37, 99, 235, 0.35));
  animation: login-boot-dots-to-line 2.8s ease-in-out infinite;
}
.login-gate-boot-orbit-wrap .login-gate-boot-weather {
  width: 96px;
  height: 96px;
  z-index: 1;
}
@keyframes login-boot-orbit-spin {
  to { transform: rotate(360deg); }
}
@keyframes login-boot-dots-to-line {
  0%, 35% {
    stroke-dasharray: 0.01 52.36;
    stroke-width: 12;
  }
  55%, 85% {
    stroke-dasharray: 628.3 0;
    stroke-width: 5;
  }
  100% {
    stroke-dasharray: 0.01 52.36;
    stroke-width: 12;
  }
}'''

if "login-boot-dots-to-line" in css:
    print("style already")
elif old_css in css:
    css = css.replace(old_css, new_css, 1)
    print("style exact ok")
else:
    m = re.search(
        r"/\* BOOT_ORBIT_DOTS_V4[\s\S]*?@keyframes login-boot-orbit-spin \{\s*to \{ transform: rotate\(360deg\); \}\s*\}",
        css,
    )
    if m:
        css = css[: m.start()] + new_css + css[m.end() :]
        print("style soft ok")
    else:
        # append if section missing
        css += "\n" + new_css + "\n"
        print("style append")

css_path.write_text(css, encoding="utf-8")
print("DONE")
