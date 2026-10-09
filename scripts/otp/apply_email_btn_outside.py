#!/usr/bin/env python3
from pathlib import Path

css = Path("public/style.css")
c = css.read_text(encoding="utf-8")
marker = "LOGIN_EMAIL_BTN_OUTSIDE"
if marker in c:
    print("already")
else:
    c += """

/* LOGIN_EMAIL_BTN_OUTSIDE — 送出鈕在輸入框外右側 */
.login-gate-magic-row {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 10px !important;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
  overflow: visible !important;
}
.login-gate-magic-input {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  height: 48px !important;
  border-radius: 999px !important;
  padding: 0 18px !important;
  /* 輸入框自己是膠囊，不再為內部按鈕留右邊空間 */
  padding-right: 18px !important;
}
.login-gate-magic-submit {
  flex: 0 0 auto !important;
  position: static !important;
  right: auto !important;
  top: auto !important;
  transform: none !important;
  width: 48px !important;
  height: 48px !important;
  min-width: 48px !important;
  border-radius: 50% !important;
  margin: 0 !important;
}
"""
    css.write_text(c, encoding="utf-8")
    print("css ok")
print("DONE")
