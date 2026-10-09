#!/usr/bin/env python3
from pathlib import Path

css = Path("public/style.css")
c = css.read_text(encoding="utf-8")
marker = "LOGIN_BUTTONS_SHIFT_DOWN"
if marker in c:
    print("already")
else:
    c += """

/* LOGIN_BUTTONS_SHIFT_DOWN */
.login-gate-buttons,
#loginGateButtons {
  margin-top: 18px !important;
}
.login-gate-tagline,
.login-gate-tagline--terminal {
  margin-bottom: 8px !important;
}
"""
    css.write_text(c, encoding="utf-8")
    print("css ok")
print("DONE")
