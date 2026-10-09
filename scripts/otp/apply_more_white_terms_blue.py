#!/usr/bin/env python3
from pathlib import Path

css = Path("public/style.css")
c = css.read_text(encoding="utf-8")
marker = "LOGIN_MORE_WHITE_TERMS_BLUE"
if marker in c:
    print("already")
else:
    c += """

/* LOGIN_MORE_WHITE_TERMS_BLUE */
.login-gate-more-toggle,
.login-gate-more-toggle span,
.login-gate-more-chevron {
  color: #ffffff !important;
  opacity: 1 !important;
}
.login-gate-more-toggle:hover,
.login-gate-more-toggle:focus,
.login-gate-more-toggle:active {
  color: #ffffff !important;
}
.login-gate-more-chevron {
  border-color: #ffffff !important;
}
/* 服務條款維持藍色，不要被白色連線規則蓋掉 */
.login-gate .login-gate-legal a,
.login-gate a[href*="terms"],
.login-gate a[href*="/terms"] {
  color: #3b82f6 !important;
}
.login-gate .login-gate-terms {
  color: rgba(255, 255, 255, 0.75) !important;
}
"""
    css.write_text(c, encoding="utf-8")
    print("css ok")
print("DONE")
