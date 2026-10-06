#!/usr/bin/env python3
from pathlib import Path

# --- HTML: replace boot orbit with weather cycle ---
html_path = Path("public/index.html")
html = html_path.read_text(encoding="utf-8")

old_boot = (
    '    <div id="loginGateBoot" class="login-gate-boot" role="status" aria-live="polite">\n'
    '      <div class="login-gate-boot-orbit" aria-hidden="true">\n'
    '        <span class="login-gate-boot-ring"></span>\n'
    '        <span class="login-gate-boot-ring login-gate-boot-ring--delay"></span>\n'
    '        <img class="login-gate-boot-logo" src="icons/logo-dark.png" alt="" />\n'
    '      </div>\n'
    '      <p class="login-gate-boot-text">正在確認登入狀態…</p>\n'
    '    </div>'
)

new_boot = (
    '    <div id="loginGateBoot" class="login-gate-boot" role="status" aria-live="polite">\n'
    '      <div class="login-gate-boot-weather" aria-hidden="true">\n'
    '        <img class="login-gate-boot-wx is-active" src="icons/sunny.png" alt="" data-wx="sunny" />\n'
    '        <img class="login-gate-boot-wx" src="icons/partly-cloudy.png" alt="" data-wx="partly" />\n'
    '        <img class="login-gate-boot-wx" src="icons/overcast.png" alt="" data-wx="overcast" />\n'
    '        <img class="login-gate-boot-wx" src="icons/drizzle.png" alt="" data-wx="drizzle" />\n'
    '        <img class="login-gate-boot-wx" src="icons/rain.png" alt="" data-wx="rain" />\n'
    '        <img class="login-gate-boot-wx" src="icons/thunderstorm.png" alt="" data-wx="storm" />\n'
    '        <img class="login-gate-boot-wx" src="icons/sunrise.png" alt="" data-wx="sunrise" />\n'
    '        <img class="login-gate-boot-wx" src="icons/sunset.png" alt="" data-wx="sunset" />\n'
    '      </div>\n'
    '      <p class="login-gate-boot-text">正在確認登入狀態…</p>\n'
    '    </div>'
)

if 'login-gate-boot-weather' in html:
    print("html already weather")
elif old_boot in html:
    html = html.replace(old_boot, new_boot)
    html_path.write_text(html, encoding="utf-8")
    print("html ok")
else:
    # softer match: replace orbit block only
    if 'login-gate-boot-orbit' in html:
        import re
        html2, n = re.subn(
            r'<div class="login-gate-boot-orbit"[\s\S]*?</div>\s*<p class="login-gate-boot-text">正在確認登入狀態…</p>',
            (
                '<div class="login-gate-boot-weather" aria-hidden="true">'
                '<img class="login-gate-boot-wx is-active" src="icons/sunny.png" alt="" />'
                '<img class="login-gate-boot-wx" src="icons/partly-cloudy.png" alt="" />'
                '<img class="login-gate-boot-wx" src="icons/overcast.png" alt="" />'
                '<img class="login-gate-boot-wx" src="icons/drizzle.png" alt="" />'
                '<img class="login-gate-boot-wx" src="icons/rain.png" alt="" />'
                '<img class="login-gate-boot-wx" src="icons/thunderstorm.png" alt="" />'
                '<img class="login-gate-boot-wx" src="icons/sunrise.png" alt="" />'
                '<img class="login-gate-boot-wx" src="icons/sunset.png" alt="" />'
                '</div>'
                '<p class="login-gate-boot-text">正在確認登入狀態…</p>'
            ),
            html,
            count=1,
        )
        if n != 1:
            raise SystemExit("regex replace failed")
        html_path.write_text(html2, encoding="utf-8")
        print("html regex ok")
    else:
        raise SystemExit("boot block not found")

# --- CSS ---
css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")
if "login-gate-boot-weather" not in css:
    css += """
.login-gate-boot-weather {
  position: relative;
  width: 120px;
  height: 120px;
}
.login-gate-boot-wx {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0;
  transform: scale(0.88);
  transition: opacity 0.55s ease, transform 0.55s ease;
  filter: drop-shadow(0 8px 18px rgba(30, 60, 120, 0.18));
}
.login-gate-boot-wx.is-active {
  opacity: 1;
  transform: scale(1);
  animation: login-boot-wx-float 2.4s ease-in-out infinite;
}
@keyframes login-boot-wx-float {
  0%, 100% { transform: scale(1) translateY(0); }
  50% { transform: scale(1.04) translateY(-4px); }
}
"""
    css_path.write_text(css, encoding="utf-8")
    print("css ok")
else:
    print("css already")

# --- JS: cycle weather icons while booting ---
js_path = Path("public/web-shim.js")
js = js_path.read_text(encoding="utf-8")

if "loginGateWeatherTimer" not in js:
    old_helper = "  function endLoginGateBoot() {\n    const gate = el(\"loginGate\");\n    const boot = el(\"loginGateBoot\");\n    if (gate) gate.classList.remove(\"login-gate--booting\");\n    if (boot) boot.classList.add(\"hidden\");\n  }"
    new_helper = (
        "  let loginGateWeatherTimer = null;\n"
        "  function startLoginGateWeatherCycle() {\n"
        "    const root = el(\"loginGateBoot\");\n"
        "    if (!root) return;\n"
        "    const frames = Array.from(root.querySelectorAll(\".login-gate-boot-wx\"));\n"
        "    if (frames.length < 2) return;\n"
        "    let i = frames.findIndex((f) => f.classList.contains(\"is-active\"));\n"
        "    if (i < 0) i = 0;\n"
        "    if (loginGateWeatherTimer) clearInterval(loginGateWeatherTimer);\n"
        "    loginGateWeatherTimer = setInterval(() => {\n"
        "      frames[i].classList.remove(\"is-active\");\n"
        "      i = (i + 1) % frames.length;\n"
        "      frames[i].classList.add(\"is-active\");\n"
        "    }, 900);\n"
        "  }\n"
        "  function endLoginGateBoot() {\n"
        "    if (loginGateWeatherTimer) { clearInterval(loginGateWeatherTimer); loginGateWeatherTimer = null; }\n"
        "    const gate = el(\"loginGate\");\n"
        "    const boot = el(\"loginGateBoot\");\n"
        "    if (gate) gate.classList.remove(\"login-gate--booting\");\n"
        "    if (boot) boot.classList.add(\"hidden\");\n"
        "  }"
    )
    if old_helper not in js:
        raise SystemExit("endLoginGateBoot helper not found")
    js = js.replace(old_helper, new_helper, 1)
    print("js helper ok")

    # start cycle at beginning of initAuthGate
    old_init = "  async function initAuthGate() {\n    showGateError();"
    new_init = "  async function initAuthGate() {\n    startLoginGateWeatherCycle();\n    showGateError();"
    if old_init in js:
        js = js.replace(old_init, new_init, 1)
        print("js start ok")
    else:
        print("WARN init start pattern missing")

    js_path.write_text(js, encoding="utf-8")
else:
    print("js already")

print("DONE")
