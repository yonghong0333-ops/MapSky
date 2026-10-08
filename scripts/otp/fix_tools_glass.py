#!/usr/bin/env python3
from pathlib import Path

css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")

if "/* tools-page enhanced glass */" in css:
    print("already")
else:
    css += '''

/* tools-page enhanced glass */
.tools-page .tools-section {
  margin-bottom: 14px;
  border-radius: 18px;
  background:
    linear-gradient(165deg, rgba(255, 255, 255, 0.42) 0%, rgba(255, 255, 255, 0.18) 100%);
  border: 1px solid rgba(255, 255, 255, 0.45);
  box-shadow:
    0 8px 28px rgba(30, 60, 120, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.65),
    inset 0 -1px 0 rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(22px) saturate(180%);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  overflow: hidden;
  padding: 4px 6px 6px;
}
.tools-page .tools-section-toggle {
  padding: 14px 12px 12px 8px;
  border-radius: 14px;
}
.tools-page .tools-section-toggle:active {
  background: rgba(255, 255, 255, 0.2);
}
.tools-page .tools-section-title {
  color: rgba(15, 23, 42, 0.92);
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.35);
}
.tools-page .tools-section-desc {
  color: rgba(51, 65, 85, 0.72);
}
.tools-page .tools-section-body {
  padding: 0 6px 8px;
}
.tools-page .tools-section .tools-grid {
  gap: 10px;
}
.tools-page .tools-menu-item {
  background:
    linear-gradient(160deg, rgba(255, 255, 255, 0.55) 0%, rgba(255, 255, 255, 0.28) 100%) !important;
  border: 1px solid rgba(255, 255, 255, 0.55) !important;
  box-shadow:
    0 6px 18px rgba(30, 60, 120, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.75) !important;
  backdrop-filter: blur(16px) saturate(170%) !important;
  -webkit-backdrop-filter: blur(16px) saturate(170%) !important;
}
.tools-page .tools-menu-item:active {
  background: rgba(255, 255, 255, 0.45) !important;
  box-shadow:
    0 2px 10px rgba(30, 60, 120, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.5) !important;
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .tools-page .tools-section {
    background: rgba(255, 255, 255, 0.72);
  }
  .tools-page .tools-menu-item {
    background: rgba(255, 255, 255, 0.82) !important;
  }
}
'''
    css_path.write_text(css, encoding="utf-8")
    print("ok")
print("DONE")
