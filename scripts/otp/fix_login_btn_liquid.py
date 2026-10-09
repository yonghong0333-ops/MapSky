#!/usr/bin/env python3
from pathlib import Path

css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")

if "LOGIN_BTN_LIQUID_GLASS" in css:
    print("already")
else:
    css += '''

/* LOGIN_BTN_LIQUID_GLASS — 登入按鈕模擬 iOS Liquid Glass */
.login-gate-btn {
  position: relative !important;
  isolation: isolate;
  overflow: hidden !important;
  border-radius: 999px !important;
  border: 1px solid rgba(255, 255, 255, 0.55) !important;
  background:
    linear-gradient(
      165deg,
      rgba(255, 255, 255, 0.55) 0%,
      rgba(255, 255, 255, 0.22) 42%,
      rgba(200, 220, 255, 0.18) 100%
    ) !important;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.75) inset,
    0 -1px 0 rgba(255, 255, 255, 0.15) inset,
    0 8px 24px rgba(30, 60, 120, 0.12),
    0 2px 6px rgba(30, 60, 120, 0.06) !important;
  backdrop-filter: blur(28px) saturate(180%) brightness(1.05) !important;
  -webkit-backdrop-filter: blur(28px) saturate(180%) brightness(1.05) !important;
  color: rgba(15, 39, 68, 0.92) !important;
  font-weight: 600 !important;
  transition:
    transform 0.22s cubic-bezier(0.34, 1.4, 0.64, 1),
    box-shadow 0.22s ease,
    border-color 0.22s ease !important;
}
/* 頂部液態高光條 */
.login-gate-btn::before {
  content: "" !important;
  position: absolute !important;
  left: 12% !important;
  right: 12% !important;
  top: 1px !important;
  height: 42% !important;
  border-radius: 999px !important;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.65) 0%,
    rgba(255, 255, 255, 0.12) 55%,
    transparent 100%
  ) !important;
  pointer-events: none !important;
  z-index: 0 !important;
}
/* 右側微折射光 */
.login-gate-btn::after {
  content: "" !important;
  /* 保留原本箭頭偽元素時可能衝突；改用 box 內高光不覆蓋 ::after 箭頭 */
}
.login-gate-btn > * {
  position: relative !important;
  z-index: 1 !important;
}
.login-gate-btn:active {
  transform: scale(0.97) !important;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.5) inset,
    0 3px 10px rgba(30, 60, 120, 0.1) !important;
}
.login-gate-btn[data-provider="google"] {
  border-color: rgba(255, 255, 255, 0.65) !important;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.8) inset,
    0 10px 28px rgba(66, 133, 244, 0.16),
    0 0 20px rgba(92, 225, 255, 0.1) !important;
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .login-gate-btn {
    background: rgba(255, 255, 255, 0.82) !important;
  }
}
'''
    css_path.write_text(css, encoding="utf-8")
    print("ok")
print("DONE")
