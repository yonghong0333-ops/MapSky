#!/usr/bin/env python3
from pathlib import Path

js = Path("public/web-shim.js")
j = js.read_text(encoding="utf-8")
changed = False
if 's.textContent = expanded ? "收起" : "更多登入方式"' in j:
    j = j.replace(
        's.textContent = expanded ? "收起" : "更多登入方式"',
        's.textContent = expanded ? "顯示較少" : "更多登入方式"',
        1,
    )
    changed = True
    print("js label ok")
elif '顯示較少' in j:
    print("js label already")
else:
    # try 收合 variant
    if 'expanded ? "收合"' in j:
        j = j.replace('expanded ? "收合" : "更多登入方式"', 'expanded ? "顯示較少" : "更多登入方式"', 1)
        changed = True
        print("js 收合->顯示較少")
    else:
        print("js pattern miss")

if changed:
    js.write_text(j, encoding="utf-8")

css = Path("public/style.css")
c = css.read_text(encoding="utf-8")
marker = "LOGIN_MORE_BOLD_WHITE"
if marker in c:
    print("css already")
else:
    c += """

/* LOGIN_MORE_BOLD_WHITE */
.login-gate-more-toggle,
.login-gate-more-toggle span:not(.login-gate-more-chevron) {
  color: #ffffff !important;
  font-weight: 700 !important;
  opacity: 1 !important;
  letter-spacing: 0.02em;
}
.login-gate-more-chevron {
  color: #ffffff !important;
  border-color: #ffffff !important;
  opacity: 1 !important;
}
"""
    css.write_text(c, encoding="utf-8")
    print("css ok")
print("DONE")
