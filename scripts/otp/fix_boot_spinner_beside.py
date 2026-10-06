#!/usr/bin/env python3
from pathlib import Path
import re

html_path = Path("public/index.html")
html = html_path.read_text(encoding="utf-8")

if "login-gate-boot-spinner" in html:
    print("html already")
else:
    # Wrap weather + spinner in a row
    old = (
        '<div class="login-gate-boot-weather" aria-hidden="true">'
    )
    # More flexible: find weather block and text
    if "login-gate-boot-weather" not in html:
        raise SystemExit("weather boot not found")

    # Insert spinner after closing of weather div, before boot text
    # Pattern: </div>\n      <p class="login-gate-boot-text">
    # but weather has nested structure ending with </div> then text

    # Replace the whole weather container start to put row wrapper
    html2, n = re.subn(
        r'(<div class="login-gate-boot-weather" aria-hidden="true">)',
        r'<div class="login-gate-boot-row" aria-hidden="true">\n        \1',
        html,
        count=1,
    )
    if n != 1:
        raise SystemExit("weather open not found")
    html = html2

    # Close row after weather closes, before boot text; add spinner
    html2, n = re.subn(
        r'(</div>)\s*(<p class="login-gate-boot-text">)',
        r'\1\n'
        r'        <span class="login-gate-boot-spinner" aria-hidden="true"></span>\n'
        r'      </div>\n'
        r'      \2',
        html,
        count=1,
    )
    # This might match wrong </div> - be more specific: last wx img then </div>
    if n != 1:
        # try after sunset.png img close
        marker = 'src="icons/sunset.png"'
        idx = html.find(marker)
        if idx < 0:
            raise SystemExit("sunset marker missing")
        # find </div> after weather section
        close = html.find("</div>", idx)
        if close < 0:
            raise SystemExit("close div missing")
        insert = (
            '</div>\n'
            '        <span class="login-gate-boot-spinner" aria-hidden="true"></span>\n'
            '      </div>'
        )
        # replace first </div> after sunset with insert (closes weather + adds spinner + closes row)
        html = html[:close] + insert + html[close + len("</div>"):]
        print("html marker ok")
    else:
        html = html2
        print("html regex ok")

    html_path.write_text(html, encoding="utf-8")

css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")
if "login-gate-boot-spinner" not in css:
    css += """
.login-gate-boot-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
}
.login-gate-boot-spinner {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-right-color: rgba(47, 111, 237, 0.9);
  animation: login-boot-spin 0.8s linear infinite;
  box-shadow: 0 2px 10px rgba(30, 60, 120, 0.15);
}
@keyframes login-boot-spin {
  to { transform: rotate(360deg); }
}
"""
    css_path.write_text(css, encoding="utf-8")
    print("css ok")
else:
    print("css already")

print("DONE")
