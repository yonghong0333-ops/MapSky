#!/usr/bin/env python3
from pathlib import Path

html_path = Path("public/index.html")
html = html_path.read_text(encoding="utf-8")

old = '''      <div id="loginGateButtons" class="login-gate-buttons hidden"></div>
      <!-- 只預設顯示 Google／Facebook，其他登入方式收在這裡，點「更多登入
           方式」才展開——同一批 providers，只是依 id 分成兩組渲染，見
           web-shim.js 的 buildGateButtons()。 -->
      <button type="button" id="loginGateMoreToggle" class="login-gate-more-toggle hidden">
        <span>更多登入方式</span>
        <span class="login-gate-more-chevron" aria-hidden="true"></span>
      </button>
      <div id="loginGateButtonsExtra" class="login-gate-buttons login-gate-buttons-extra hidden"></div>'''

new = '''      <div id="loginGateButtons" class="login-gate-buttons hidden"></div>
      <!-- 其他登入方式；「更多／收起」放在這批按鈕下方、「或」分隔線上方 -->
      <div id="loginGateButtonsExtra" class="login-gate-buttons login-gate-buttons-extra hidden"></div>
      <button type="button" id="loginGateMoreToggle" class="login-gate-more-toggle hidden">
        <span>更多登入方式</span>
        <span class="login-gate-more-chevron" aria-hidden="true"></span>
      </button>'''

if old in html:
    html = html.replace(old, new, 1)
    print("html exact ok")
elif 'id="loginGateMoreToggle"' in html and html.find("loginGateMoreToggle") < html.find("loginGateButtonsExtra"):
    # move toggle after extra
    import re
    m = re.search(
        r'\s*<!-- 只預設顯示[\s\S]*?-->\s*'
        r'<button type="button" id="loginGateMoreToggle"[\s\S]*?</button>\s*'
        r'(<div id="loginGateButtonsExtra"[\s\S]*?</div>)',
        html,
    )
    if not m:
        # simpler: extract button and extra
        btn_m = re.search(
            r'(<button type="button" id="loginGateMoreToggle"[\s\S]*?</button>)',
            html,
        )
        extra_m = re.search(
            r'(<div id="loginGateButtonsExtra"[^>]*>\s*</div>)',
            html,
        )
        if not btn_m or not extra_m:
            raise SystemExit("btn/extra not found")
        btn = btn_m.group(1)
        extra = extra_m.group(1)
        # remove button from old place
        html2 = html[:btn_m.start()] + html[btn_m.end():]
        # find extra again in html2
        extra_m2 = re.search(
            r'(<div id="loginGateButtonsExtra"[^>]*>\s*</div>)',
            html2,
        )
        if not extra_m2:
            raise SystemExit("extra after remove missing")
        html = (
            html2[:extra_m2.end()]
            + "\n      " + btn
            + html2[extra_m2.end():]
        )
        print("html move ok")
    else:
        html = html[:m.start()] + "\n      " + m.group(1) + "\n      " + m.group(0).split("<div id=\"loginGateButtonsExtra\"")[0].split("</button>")[-1] 
        raise SystemExit("complex path")
elif html.find("loginGateButtonsExtra") < html.find("loginGateMoreToggle"):
    print("html already ordered")
else:
    raise SystemExit("unexpected structure")

html_path.write_text(html, encoding="utf-8")

# CSS: margin so toggle sits nicely above divider
css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")
if "login-gate-more-toggle-bottom" not in css:
    css += """
/* 更多／收起：在額外登入方式下方、「或」上方 */
.login-gate-more-toggle {
  margin-top: 12px;
  margin-bottom: 4px;
}
.login-gate-buttons-extra:not(.hidden) + .login-gate-more-toggle {
  margin-top: 10px;
}
"""
    css_path.write_text(css, encoding="utf-8")
    print("css ok")
else:
    print("css already")

# verify order
h2 = Path("public/index.html").read_text(encoding="utf-8")
i_extra = h2.find("loginGateButtonsExtra")
i_more = h2.find("loginGateMoreToggle")
i_div = h2.find("login-gate-divider")
if not (i_extra < i_more < i_div):
    raise SystemExit(f"order wrong: extra={i_extra} more={i_more} div={i_div}")
print("order OK")
print("DONE")
