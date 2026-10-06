#!/usr/bin/env python3
from pathlib import Path

css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")

if "/* === MapSky Tech UI === */" in css:
    print("already applied")
else:
    css += r'''

/* === MapSky Tech UI ===
   科技感：深玻璃面板、青色描邊、等寬數字、微光暈 */
:root {
  --tech-cyan: #5ce1ff;
  --tech-cyan-dim: rgba(92, 225, 255, 0.45);
  --tech-line: rgba(92, 225, 255, 0.28);
  --tech-panel: rgba(8, 18, 40, 0.42);
  --tech-panel-2: rgba(12, 28, 58, 0.38);
  --tech-glow: 0 0 24px rgba(92, 225, 255, 0.18);
}

/* 主天氣卡 */
.current-card {
  position: relative;
  background:
    linear-gradient(145deg, rgba(20, 48, 96, 0.72) 0%, rgba(12, 32, 72, 0.68) 45%, rgba(8, 24, 56, 0.75) 100%);
  border: 1px solid var(--tech-line);
  border-radius: 18px;
  box-shadow:
    var(--tech-glow),
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    0 12px 32px rgba(0, 20, 60, 0.28);
  overflow: hidden;
}
.current-card::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, transparent 0%, rgba(92, 225, 255, 0.06) 50%, transparent 100%);
  background-size: 200% 100%;
  pointer-events: none;
  opacity: 0.7;
}
.current-card::after {
  /* 四角科技框線感 */
  content: "";
  position: absolute;
  inset: 8px;
  border: 1px solid rgba(92, 225, 255, 0.12);
  border-radius: 12px;
  pointer-events: none;
  mask-image:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-image:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .current-card {
    background: linear-gradient(145deg, #1a3a78 0%, #123060 55%, #0c2248 100%);
  }
}
.current-card.liquid-glass-refraction {
  background: linear-gradient(145deg, rgba(20, 48, 96, 0.55) 0%, rgba(12, 32, 72, 0.5) 55%, rgba(8, 24, 56, 0.6) 100%);
}

.current-temp {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 54px;
  font-weight: 700;
  letter-spacing: -0.04em;
  text-shadow: 0 0 18px rgba(92, 225, 255, 0.35);
}
.current-desc {
  letter-spacing: 0.04em;
  font-weight: 600;
}
.current-detail {
  font-size: 12px;
  opacity: 0.88;
  letter-spacing: 0.02em;
  color: rgba(220, 240, 255, 0.9);
}

.current-stat-chip {
  background: rgba(6, 16, 36, 0.35);
  border: 1px solid rgba(92, 225, 255, 0.22);
  border-radius: 12px;
  box-shadow: inset 0 0 12px rgba(92, 225, 255, 0.06);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.current-stat-label {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: none;
  opacity: 0.75;
}
.current-stat-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 14px;
  font-weight: 700;
  color: #e8f7ff;
}

/* 「查看完整預報」按鈕科技感 */
.current-card a.full-forecast-link,
.current-card .full-forecast-btn,
.current-card button.full-forecast-link,
#openFullForecastBtn,
.current-card .forecast-more-btn {
  border: 1px solid rgba(92, 225, 255, 0.35) !important;
  background: rgba(8, 24, 56, 0.35) !important;
  color: #dff6ff !important;
  letter-spacing: 0.06em;
  box-shadow: 0 0 12px rgba(92, 225, 255, 0.12);
}

/* 36 小時預報小卡 */
.forecast-card {
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.72), rgba(230, 242, 255, 0.55));
  border: 1px solid rgba(47, 111, 237, 0.18);
  border-radius: 14px;
  box-shadow: 0 4px 14px rgba(30, 60, 120, 0.08);
  position: relative;
}
.forecast-card .fdate {
  font-size: 12px;
  letter-spacing: 0.04em;
  color: #1e3a5f;
}
.forecast-card .ftemp {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  letter-spacing: -0.02em;
}
.forecast-card .fpop {
  color: #2a7fd4;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

/* 其他資訊卡 */
.extra-info-card {
  background: linear-gradient(165deg, rgba(255, 255, 255, 0.78), rgba(236, 246, 255, 0.62));
  border: 1px solid rgba(47, 111, 237, 0.16);
  border-radius: 14px;
  box-shadow: 0 4px 12px rgba(30, 60, 120, 0.06);
}
.extra-info-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  letter-spacing: -0.01em;
}
.extra-info-label {
  letter-spacing: 0.04em;
  font-size: 11px;
}

/* 城市標題 */
.main-header h2#cityName,
#cityName {
  letter-spacing: 0.06em;
  font-weight: 700;
}

/* 區塊標題左側青色指示條 */
.section-title {
  position: relative;
  padding-left: 10px;
  letter-spacing: 0.04em;
}
.section-title::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.15em;
  bottom: 0.15em;
  width: 3px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--tech-cyan), #2f6fed);
  box-shadow: 0 0 8px rgba(92, 225, 255, 0.5);
}

/* 底部導覽微科技描邊（不改結構） */
.bottom-nav {
  border: 1px solid rgba(92, 225, 255, 0.15);
  box-shadow: 0 8px 28px rgba(20, 40, 90, 0.18), 0 0 0 1px rgba(255, 255, 255, 0.2) inset;
}
'''
    css_path.write_text(css, encoding="utf-8")
    print("css applied")

# Tweak full-forecast button if it has a known class in HTML
html = Path("public/index.html").read_text(encoding="utf-8")
# find the 查看完整預報 element class
if "查看完整預報" in html:
    import re
    m = re.search(r'[^>]*>查看完整預報[^<]*', html)
    if m:
        print("found link context", html[max(0,m.start()-80):m.start()+40])
print("DONE")
