#!/usr/bin/env python3
from pathlib import Path
import re

html_path = Path("public/index.html")
html = html_path.read_text(encoding="utf-8")

# Restructure: orbit wraps weather icons; spinner is a ring around them
if "login-gate-boot-orbit-wrap" in html:
    print("html already orbit")
else:
    # Replace boot-row structure with orbit wrap
    # Expected roughly:
    # <div class="login-gate-boot-row">
    #   <div class="login-gate-boot-weather">...imgs...</div>
    #   <span class="login-gate-boot-spinner"></span>
    # </div>

    if "login-gate-boot-row" in html:
        html2, n = re.subn(
            r'<div class="login-gate-boot-row" aria-hidden="true">\s*'
            r'<div class="login-gate-boot-weather" aria-hidden="true">',
            '<div class="login-gate-boot-orbit-wrap" aria-hidden="true">\n'
            '        <span class="login-gate-boot-orbit-ring"></span>\n'
            '        <div class="login-gate-boot-weather">',
            html,
            count=1,
        )
        if n != 1:
            raise SystemExit("row+weather open not found")
        html = html2
        # Remove standalone spinner span and rename closing: after weather </div>, remove spinner, keep one close for orbit-wrap
        html2, n = re.subn(
            r'</div>\s*<span class="login-gate-boot-spinner"[^>]*></span>\s*</div>',
            '</div>\n      </div>',
            html,
            count=1,
        )
        if n != 1:
            # try without self-closing variations
            html2, n = re.subn(
                r'</div>\s*<span class="login-gate-boot-spinner"[\s\S]*?</span>\s*</div>',
                '</div>\n      </div>',
                html,
                count=1,
            )
        if n != 1:
            raise SystemExit("spinner close not found")
        html = html2
        html_path.write_text(html, encoding="utf-8")
        print("html ok")
    elif "login-gate-boot-weather" in html:
        html2, n = re.subn(
            r'<div class="login-gate-boot-weather" aria-hidden="true">',
            '<div class="login-gate-boot-orbit-wrap" aria-hidden="true">\n'
            '        <span class="login-gate-boot-orbit-ring"></span>\n'
            '        <div class="login-gate-boot-weather">',
            html,
            count=1,
        )
        if n != 1:
            raise SystemExit("weather only open not found")
        html = html2
        # close orbit after weather - after sunset img section
        idx = html.find('src="icons/sunset.png"')
        if idx < 0:
            raise SystemExit("sunset missing")
        close = html.find("</div>", idx)
        html = html[:close] + "</div>\n      </div>" + html[close + len("</div>"):]
        html_path.write_text(html, encoding="utf-8")
        print("html weather-only ok")
    else:
        raise SystemExit("boot weather missing")

css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")

# Update / add orbit styles
if "login-gate-boot-orbit-wrap" not in css:
    css += """
.login-gate-boot-orbit-wrap {
  position: relative;
  width: 148px;
  height: 148px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.login-gate-boot-orbit-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.28);
  border-top-color: #ffffff;
  border-right-color: rgba(47, 111, 237, 0.95);
  animation: login-boot-spin 0.9s linear infinite;
  box-sizing: border-box;
  pointer-events: none;
}
.login-gate-boot-orbit-wrap .login-gate-boot-weather {
  width: 100px;
  height: 100px;
}
"""
    css_path.write_text(css, encoding="utf-8")
    print("css added")
else:
    print("css already")

# Soften old side-by-side spinner if present so it doesn't fight layout
if ".login-gate-boot-spinner" in css and "display: none" not in css[css.find(".login-gate-boot-spinner"):css.find(".login-gate-boot-spinner")+200]:
    css = css.replace(
        ".login-gate-boot-spinner {",
        ".login-gate-boot-spinner { display: none; /* replaced by orbit ring */\n.login-gate-boot-spinner-legacy {",
        1,
    )
    # that might break CSS - skip if risky
    # Better: just leave old rule, spinner removed from HTML

print("DONE")
