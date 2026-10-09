#!/usr/bin/env python3
from pathlib import Path

css = Path("public/style.css")
c = css.read_text(encoding="utf-8")
marker = "LOGIN_LEGAL_WHITE"
if marker in c:
    print("already")
else:
    c += """

/* LOGIN_LEGAL_WHITE */
.login-gate-legal,
.login-gate .login-gate-legal {
  color: #ffffff !important;
  opacity: 1 !important;
}
/* 服務條款連結維持藍色 */
.login-gate-legal a,
.login-gate .login-gate-legal a,
.login-gate a[href*="terms"] {
  color: #3b82f6 !important;
}
"""
    css.write_text(c, encoding="utf-8")
    print("css ok")
print("DONE")
