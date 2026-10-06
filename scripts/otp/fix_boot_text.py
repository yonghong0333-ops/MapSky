#!/usr/bin/env python3
from pathlib import Path
import re

html_path = Path("public/index.html")
html = html_path.read_text(encoding="utf-8")

# Ensure boot text paragraph exists under the orbit
if 'class="login-gate-boot-text"' not in html:
    # insert before closing of loginGateBoot
    if 'id="loginGateBoot"' not in html:
        raise SystemExit("loginGateBoot missing")
    html2, n = re.subn(
        r'(id="loginGateBoot"[^>]*>)([\s\S]*?)(</div>\s*<div class="login-gate-card")',
        r'\1\2\n      <p class="login-gate-boot-text" id="loginGateBootText">正在確認登入狀態…</p>\n    \3',
        html,
        count=1,
    )
    if n != 1:
        raise SystemExit("could not insert boot text")
    html = html2
    print("html inserted text")
else:
    # ensure id for JS updates
    if 'id="loginGateBootText"' not in html:
        html = html.replace(
            'class="login-gate-boot-text"',
            'class="login-gate-boot-text" id="loginGateBootText"',
            1,
        )
        print("html added id")
    # ensure non-empty default text
    html2, n = re.subn(
        r'(<p class="login-gate-boot-text"[^>]*>)\s*(</p>)',
        r'\1正在確認登入狀態…\2',
        html,
        count=1,
    )
    if n:
        html = html2
        print("html filled empty")
    else:
        print("html text ok")

html_path.write_text(html, encoding="utf-8")

# CSS ensure text visible
css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")
if ".login-gate-boot-text" not in css:
    css += """
.login-gate-boot-text {
  margin-top: 22px;
  font-size: 14px;
  font-weight: 500;
  color: rgba(31, 41, 55, 0.6);
  letter-spacing: 0.02em;
  text-align: center;
}
"""
    css_path.write_text(css, encoding="utf-8")
    print("css ok")
else:
    print("css already")

# JS: update boot text by stage
js_path = Path("public/web-shim.js")
js = js_path.read_text(encoding="utf-8")

if "function setLoginGateBootText" not in js:
    helper = (
        "  function setLoginGateBootText(msg) {\n"
        "    const t = el(\"loginGateBootText\") || document.querySelector(\".login-gate-boot-text\");\n"
        "    if (t) t.textContent = msg || \"\";\n"
        "  }\n\n"
    )
    js = js.replace(
        "  function endLoginGateBoot() {",
        helper + "  function endLoginGateBoot() {",
        1,
    )
    print("helper ok")

# On init start
if "setLoginGateBootText(\"正在確認登入狀態" not in js:
    js = js.replace(
        "    startLoginGateWeatherCycle();\n",
        "    startLoginGateWeatherCycle();\n"
        "    setLoginGateBootText(\"正在確認登入狀態…\");\n",
        1,
    )
    print("init text ok")

# When logged in waiting for weather data
if "載入天氣與相關資訊中" not in js:
    old = "      // 已登入：等天氣資料出來再停轉圈（renderer 會呼叫 __mapskyOnWeatherDataReady）\n"
    if old in js:
        js = js.replace(
            old,
            old + "      setLoginGateBootText(\"載入天氣與相關資訊中…\");\n",
            1,
        )
        print("logged-in text ok")
    else:
        # broader
        marker = "window.__mapskyOnWeatherDataReady = function () {"
        if marker in js:
            js = js.replace(
                marker,
                "setLoginGateBootText(\"載入天氣與相關資訊中…\");\n      " + marker,
                1,
            )
            print("logged-in text alt")

js_path.write_text(js, encoding="utf-8")
print("DONE")
