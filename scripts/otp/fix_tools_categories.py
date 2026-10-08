#!/usr/bin/env python3
from pathlib import Path
import re

html_path = Path("public/index.html")
html = html_path.read_text(encoding="utf-8")

old = '''      <section id="toolsPanel" class="tab-panel">
        <div class="settings-page">
          <h2 class="settings-page-title">🧰 工具</h2>
          <div class="tools-grid">
            <button class="tools-menu-item" data-tab="weekly"><span class="tool-icon">📅</span><span class="tool-label">未來 7 天</span></button>
            <button class="tools-menu-item" data-tab="chart"><span class="tool-icon">📈</span><span class="tool-label">溫度趨勢圖</span></button>
            <button class="tools-menu-item" data-tab="compare"><span class="tool-icon">🏙️</span><span class="tool-label">多城市比較</span></button>
            <button class="tools-menu-item" data-tab="map"><span class="tool-icon">🗺️</span><span class="tool-label">地圖選點</span></button>
            <button class="tools-menu-item" data-tab="typhoon"><span class="tool-icon">🌀</span><span class="tool-label">颱風</span></button>
            <button class="tools-menu-item" id="lightningMapBtn" type="button"><span class="tool-icon">⚡</span><span class="tool-label">即時閃電</span></button>
            <button class="tools-menu-item hidden" data-tab="alerts"><span class="tool-icon">⚠️</span><span class="tool-label">警特報</span><span id="toolsAlertBadge" class="alert-tab-badge hidden">0</span></button>
          </div>
        </div>
      </section>'''

new = '''      <section id="toolsPanel" class="tab-panel">
        <div class="settings-page tools-page">
          <h2 class="settings-page-title">🧰 工具</h2>

          <div class="tools-section">
            <h3 class="tools-section-title">預報與趨勢</h3>
            <p class="tools-section-desc">查看未來天氣與溫度變化</p>
            <div class="tools-grid">
              <button class="tools-menu-item" data-tab="weekly" type="button">
                <span class="tool-icon" aria-hidden="true">📅</span>
                <span class="tool-label">未來 7 天</span>
                <span class="tool-hint">一週預報總覽</span>
              </button>
              <button class="tools-menu-item" data-tab="chart" type="button">
                <span class="tool-icon" aria-hidden="true">📈</span>
                <span class="tool-label">溫度趨勢圖</span>
                <span class="tool-hint">高低溫曲線</span>
              </button>
            </div>
          </div>

          <div class="tools-section">
            <h3 class="tools-section-title">探索與比較</h3>
            <p class="tools-section-desc">在地圖上選點、比較不同城市</p>
            <div class="tools-grid">
              <button class="tools-menu-item" data-tab="compare" type="button">
                <span class="tool-icon" aria-hidden="true">🏙️</span>
                <span class="tool-label">多城市比較</span>
                <span class="tool-hint">並排看天氣</span>
              </button>
              <button class="tools-menu-item" data-tab="map" type="button">
                <span class="tool-icon" aria-hidden="true">🗺️</span>
                <span class="tool-label">地圖選點</span>
                <span class="tool-hint">點地圖查天氣</span>
              </button>
            </div>
          </div>

          <div class="tools-section">
            <h3 class="tools-section-title">災害與即時</h3>
            <p class="tools-section-desc">颱風動態與閃電即時資訊</p>
            <div class="tools-grid">
              <button class="tools-menu-item" data-tab="typhoon" type="button">
                <span class="tool-icon" aria-hidden="true">🌀</span>
                <span class="tool-label">颱風</span>
                <span class="tool-hint">路徑與警報</span>
              </button>
              <button class="tools-menu-item" id="lightningMapBtn" type="button">
                <span class="tool-icon" aria-hidden="true">⚡</span>
                <span class="tool-label">即時閃電</span>
                <span class="tool-hint">閃電分布圖</span>
              </button>
              <button class="tools-menu-item hidden" data-tab="alerts" type="button">
                <span class="tool-icon" aria-hidden="true">⚠️</span>
                <span class="tool-label">警特報</span>
                <span class="tool-hint">生效中警報</span>
                <span id="toolsAlertBadge" class="alert-tab-badge hidden">0</span>
              </button>
            </div>
          </div>
        </div>
      </section>'''

if "tools-section-title" in html and "預報與趨勢" in html:
    print("html already")
elif old in html:
    html = html.replace(old, new, 1)
    html_path.write_text(html, encoding="utf-8")
    print("html exact ok")
else:
    # softer: replace from toolsPanel section inner tools-grid only
    m = re.search(
        r'(<section id="toolsPanel" class="tab-panel">)([\s\S]*?)(</section>\s*\n\s*<section id="settingsPanel")',
        html,
    )
    if not m:
        raise SystemExit("toolsPanel block not found")
    inner = new[new.find("<div class=\"settings-page"):new.rfind("</section>")].strip()
    # new includes section tags - extract inner only
    inner_m = re.search(r'<section id="toolsPanel"[^>]*>([\s\S]*)</section>\s*$', new.strip())
    if not inner_m:
        raise SystemExit("parse new failed")
    html = html[:m.start()] + m.group(1) + "\n" + inner_m.group(1) + "\n      " + m.group(3)
    # fix - m.group(3) starts with </section>... settings
    html = html[:m.start()] + new + "\n\n      " + html[m.end():]
    # That might double. Simpler:
    html = Path("public/index.html").read_text(encoding="utf-8")
    m = re.search(
        r'<section id="toolsPanel" class="tab-panel">[\s\S]*?</section>(?=\s*<section id="settingsPanel")',
        html,
    )
    if not m:
        raise SystemExit("toolsPanel soft not found")
    html = html[:m.start()] + new.strip() + html[m.end():]
    html_path.write_text(html, encoding="utf-8")
    print("html soft ok")

# --- CSS ---
css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")
if "tools-section-title" not in css:
    css += '''

/* ---- 工具頁分類 ---- */
.tools-page {
  padding-bottom: 24px;
}
.tools-section {
  margin-bottom: 22px;
}
.tools-section-title {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-main, #0f172a);
  letter-spacing: 0.02em;
  padding-left: 10px;
  position: relative;
}
.tools-section-title::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.2em;
  bottom: 0.2em;
  width: 3px;
  border-radius: 2px;
  background: linear-gradient(180deg, #38bdf8, #2f6fed);
}
.tools-section-desc {
  margin: 0 0 12px;
  padding-left: 10px;
  font-size: 12px;
  color: var(--text-muted, #64748b);
  line-height: 1.4;
}
.tools-section .tools-grid {
  gap: 12px;
}
.tools-menu-item .tool-hint {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted, #64748b);
  line-height: 1.3;
  opacity: 0.9;
}
.tools-menu-item {
  min-height: 112px;
  padding: 18px 12px 16px;
  gap: 6px;
}
.tools-menu-item .tool-icon {
  font-size: 30px;
  margin-bottom: 2px;
}
.tools-menu-item .tool-label {
  font-size: 14px;
  font-weight: 700;
}
'''
    css_path.write_text(css, encoding="utf-8")
    print("css ok")
else:
    print("css already")

print("DONE")
