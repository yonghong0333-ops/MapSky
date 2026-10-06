#!/usr/bin/env python3
from pathlib import Path
css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")
if ".current-forecast-btn" in css and "tech-cyan" in css[css.find(".current-forecast-btn"):css.find(".current-forecast-btn")+300]:
    print("already")
else:
    css += """
.current-forecast-btn {
  width: 100%;
  margin-top: 4px;
  padding: 12px 16px;
  border-radius: 999px;
  border: 1px solid rgba(92, 225, 255, 0.4);
  background: rgba(6, 18, 42, 0.35);
  color: #e6f9ff;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.08em;
  cursor: pointer;
  box-shadow: 0 0 14px rgba(92, 225, 255, 0.12);
  -webkit-appearance: none;
  appearance: none;
}
.current-forecast-btn:active {
  background: rgba(92, 225, 255, 0.12);
}
"""
    css_path.write_text(css, encoding="utf-8")
    print("ok")
