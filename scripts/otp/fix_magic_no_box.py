#!/usr/bin/env python3
from pathlib import Path

css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")

if "MAGIC_ROW_NO_BOX" in css:
    print("already")
else:
    css += '''

/* MAGIC_ROW_NO_BOX — 信箱列不要外框方框 */
.login-gate-magic-row {
  position: relative !important;
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  padding: 4px 0 !important;
  border: none !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  overflow: visible !important;
}
.login-gate-magic-input {
  flex: 1 !important;
  width: auto !important;
  min-width: 0 !important;
  padding: 12px 4px !important;
  border: none !important;
  border-bottom: 1px solid rgba(15, 39, 68, 0.18) !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  outline: none !important;
  font-size: 15px !important;
  color: #0f2744 !important;
  box-sizing: border-box !important;
}
.login-gate-magic-input:focus {
  border: none !important;
  border-bottom: 1.5px solid rgba(47, 111, 237, 0.55) !important;
  outline: none !important;
  box-shadow: none !important;
}
.login-gate-magic-input::placeholder {
  color: rgba(15, 39, 68, 0.4) !important;
}
.login-gate-magic-submit {
  position: relative !important;
  right: auto !important;
  top: auto !important;
  transform: none !important;
  width: 44px !important;
  height: 44px !important;
  margin: 0 !important;
  border: none !important;
  border-radius: 50% !important;
  background: linear-gradient(145deg, #5b9cf5, #2f6fed) !important;
  box-shadow: 0 4px 12px rgba(47, 111, 237, 0.35) !important;
  flex-shrink: 0 !important;
}
'''
    css_path.write_text(css, encoding="utf-8")
    print("ok")
print("DONE")
