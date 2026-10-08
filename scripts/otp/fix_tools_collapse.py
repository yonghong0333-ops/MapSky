#!/usr/bin/env python3
from pathlib import Path
import re

html_path = Path("public/index.html")
html = html_path.read_text(encoding="utf-8")

# Replace section headers with collapsible buttons
# Pattern for each section
def make_section(key, title, desc, grid_inner):
    return f'''          <div class="tools-section" data-tools-section="{key}">
            <button type="button" class="tools-section-toggle" aria-expanded="true">
              <span class="tools-section-toggle-text">
                <span class="tools-section-title">{title}</span>
                <span class="tools-section-desc">{desc}</span>
              </span>
              <span class="tools-section-chevron" aria-hidden="true"></span>
            </button>
            <div class="tools-section-body">
              <div class="tools-grid">
{grid_inner}
              </div>
            </div>
          </div>'''

# Extract current tools panel and rebuild
m = re.search(
    r'<section id="toolsPanel" class="tab-panel">[\s\S]*?</section>(?=\s*<section id="settingsPanel")',
    html,
)
if not m:
    raise SystemExit("toolsPanel not found")

if "tools-section-toggle" in m.group(0):
    print("html already collapsible")
else:
    # Pull button blocks from existing if categorized
    block = m.group(0)
    # Extract grid contents by section titles
    sections = [
        ("forecast", "預報與趨勢", "查看未來天氣與溫度變化",
         '''              <button class="tools-menu-item" data-tab="weekly" type="button">
                <span class="tool-icon" aria-hidden="true">📅</span>
                <span class="tool-label">未來 7 天</span>
                <span class="tool-hint">一週預報總覽</span>
              </button>
              <button class="tools-menu-item" data-tab="chart" type="button">
                <span class="tool-icon" aria-hidden="true">📈</span>
                <span class="tool-label">溫度趨勢圖</span>
                <span class="tool-hint">高低溫曲線</span>
              </button>'''),
        ("explore", "探索與比較", "在地圖上選點、比較不同城市",
         '''              <button class="tools-menu-item" data-tab="compare" type="button">
                <span class="tool-icon" aria-hidden="true">🏙️</span>
                <span class="tool-label">多城市比較</span>
                <span class="tool-hint">並排看天氣</span>
              </button>
              <button class="tools-menu-item" data-tab="map" type="button">
                <span class="tool-icon" aria-hidden="true">🗺️</span>
                <span class="tool-label">地圖選點</span>
                <span class="tool-hint">點地圖查天氣</span>
              </button>'''),
        ("hazard", "災害與即時", "颱風動態與閃電即時資訊",
         '''              <button class="tools-menu-item" data-tab="typhoon" type="button">
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
              </button>'''),
    ]
    parts = ['''      <section id="toolsPanel" class="tab-panel">
        <div class="settings-page tools-page">
          <h2 class="settings-page-title">🧰 工具</h2>
''']
    for key, title, desc, grid in sections:
        parts.append(make_section(key, title, desc, grid))
    parts.append('''        </div>
      </section>''')
    new_block = "\n".join(parts)
    html = html[:m.start()] + new_block + html[m.end():]
    html_path.write_text(html, encoding="utf-8")
    print("html ok")

# CSS
css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")
if "tools-section-toggle" not in css:
    css += '''

/* 工具分類收合 */
.tools-section-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 10px 4px 10px 0;
  margin: 0;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  -webkit-tap-highlight-color: transparent;
}
.tools-section-toggle-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.tools-section-toggle .tools-section-title {
  margin: 0;
  padding-left: 10px;
}
.tools-section-toggle .tools-section-desc {
  margin: 0;
  padding-left: 10px;
}
.tools-section-chevron {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-right: 2px solid var(--text-muted, #64748b);
  border-bottom: 2px solid var(--text-muted, #64748b);
  transform: rotate(45deg);
  transition: transform 0.2s ease;
  margin-right: 8px;
  margin-top: -4px;
}
.tools-section.is-collapsed .tools-section-chevron {
  transform: rotate(-45deg);
  margin-top: 2px;
}
.tools-section-body {
  overflow: hidden;
  transition: max-height 0.25s ease, opacity 0.2s ease;
  max-height: 480px;
  opacity: 1;
}
.tools-section.is-collapsed .tools-section-body {
  max-height: 0;
  opacity: 0;
  pointer-events: none;
}
.tools-section.is-collapsed {
  margin-bottom: 8px;
}
'''
    css_path.write_text(css, encoding="utf-8")
    print("css ok")
else:
    print("css already")

# JS in renderer.js
r_path = Path("public/renderer.js")
r = r_path.read_text(encoding="utf-8")
if "initToolsSectionCollapse" in r:
    print("js already")
else:
    snippet = '''
// 工具頁分類收合（記住使用者偏好）
(function initToolsSectionCollapse() {
  const KEY = "mapsky_tools_sections_collapsed";
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { saved = {}; }

  document.querySelectorAll(".tools-section[data-tools-section]").forEach((sec) => {
    const id = sec.getAttribute("data-tools-section");
    const btn = sec.querySelector(".tools-section-toggle");
    if (!btn) return;
    if (saved[id]) {
      sec.classList.add("is-collapsed");
      btn.setAttribute("aria-expanded", "false");
    }
    btn.addEventListener("click", () => {
      const collapsed = sec.classList.toggle("is-collapsed");
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      try {
        const cur = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
        cur[id] = collapsed;
        localStorage.setItem(KEY, JSON.stringify(cur));
      } catch (e) {}
    });
  });
})();
'''
    # append near tools-menu-item handlers
    marker = 'document.querySelectorAll(".tools-menu-item[data-tab]").forEach((item) => {'
    if marker in r:
        r = r.replace(marker, snippet + "\n" + marker, 1)
        print("js near tools click")
    else:
        r = r + "\n" + snippet
        print("js append")
    r_path.write_text(r, encoding="utf-8")

print("DONE")
