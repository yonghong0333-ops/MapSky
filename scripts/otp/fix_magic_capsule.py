#!/usr/bin/env python3
from pathlib import Path

css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")

if "MAGIC_ROW_CAPSULE" in css:
    print("already")
else:
    css += '''

/* MAGIC_ROW_CAPSULE — 信箱列強制膠囊形，禁止方框 */
.login-gate-magic-row {
  position: relative !important;
  display: flex !important;
  align-items: center !important;
  gap: 0 !important;
  min-height: 52px !important;
  padding: 4px 4px 4px 18px !important;
  border-radius: 9999px !important;
  border: 1px solid rgba(255, 255, 255, 0.5) !important;
  background:
    linear-gradient(
      165deg,
      rgba(255, 255, 255, 0.55) 0%,
      rgba(255, 255, 255, 0.28) 100%
    ) !important;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.7) inset,
    0 6px 18px rgba(30, 60, 120, 0.1) !important;
  backdrop-filter: blur(20px) saturate(170%) !important;
  -webkit-backdrop-filter: blur(20px) saturate(170%) !important;
  overflow: hidden !important;
}
.login-gate-magic-input {
  flex: 1 !important;
  width: auto !important;
  min-width: 0 !important;
  height: 44px !important;
  padding: 0 12px 0 2px !important;
  border: none !important;
  border-bottom: none !important;
  border-radius: 9999px !important;
  background: transparent !important;
  box-shadow: none !important;
  outline: none !important;
  font-size: 15px !important;
  color: #0f2744 !important;
  box-sizing: border-box !important;
}
.login-gate-magic-input:focus {
  border: none !important;
  border-bottom: none !important;
  outline: none !important;
  box-shadow: none !important;
}
.login-gate-magic-submit {
  position: relative !important;
  right: auto !important;
  top: auto !important;
  transform: none !important;
  width: 44px !important;
  height: 44px !important;
  min-width: 44px !important;
  margin: 0 !important;
  border: none !important;
  border-radius: 50% !important;
  background: linear-gradient(145deg, #5b9cf5, #2f6fed) !important;
  box-shadow: 0 4px 12px rgba(47, 111, 237, 0.35) !important;
  flex-shrink: 0 !important;
}
.login-gate-magic-submit:hover,
.login-gate-magic-submit:active {
  transform: scale(0.94) !important;
}
'''
    css_path.write_text(css, encoding="utf-8")
    print("ok")
print("DONE")
