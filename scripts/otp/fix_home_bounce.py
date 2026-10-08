#!/usr/bin/env python3
from pathlib import Path

css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")

if "home-glass-bounce" in css:
    print("css already")
else:
    css += '''

/* home-glass-bounce: 首頁卡片點擊回彈 + 白色光效 */
.current-card,
.current-stat-chip,
.current-forecast-btn,
.forecast-card,
.extra-info-card,
.fav-star-btn {
  position: relative;
  overflow: hidden;
  transition:
    transform 0.32s cubic-bezier(0.34, 1.45, 0.64, 1),
    box-shadow 0.25s ease;
  -webkit-tap-highlight-color: transparent;
}
.current-card::after,
.current-stat-chip::after,
.current-forecast-btn::after,
.forecast-card::after,
.extra-info-card::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(circle at var(--ripple-x, 50%) var(--ripple-y, 50%),
    rgba(255, 255, 255, 0.7) 0%,
    rgba(255, 255, 255, 0.25) 40%,
    transparent 72%);
  opacity: 0;
  pointer-events: none;
  z-index: 3;
}
.current-card.is-pressing,
.current-stat-chip.is-pressing,
.current-forecast-btn.is-pressing,
.forecast-card.is-pressing,
.extra-info-card.is-pressing,
.fav-star-btn.is-pressing {
  transform: scale(0.97);
}
.current-card.is-pressing::after,
.current-stat-chip.is-pressing::after,
.current-forecast-btn.is-pressing::after,
.forecast-card.is-pressing::after,
.extra-info-card.is-pressing::after {
  opacity: 1;
}
.current-card.is-bounce,
.current-stat-chip.is-bounce,
.current-forecast-btn.is-bounce,
.forecast-card.is-bounce,
.extra-info-card.is-bounce,
.fav-star-btn.is-bounce {
  animation: tools-glass-bounce 0.48s cubic-bezier(0.34, 1.45, 0.64, 1);
}
.current-card.is-flash::after,
.current-stat-chip.is-flash::after,
.current-forecast-btn.is-flash::after,
.forecast-card.is-flash::after,
.extra-info-card.is-flash::after {
  animation: tools-glass-flash 0.55s ease-out;
}
'''
    css_path.write_text(css, encoding="utf-8")
    print("css ok")

r_path = Path("public/renderer.js")
r = r_path.read_text(encoding="utf-8")

# Expand initToolsGlassPress selectors + re-bind for dynamic forecast cards
old = '''  document.querySelectorAll(".tools-page .tools-section-toggle, .tools-page .tools-menu-item").forEach(bindPress);
})();'''

new = '''  const homeSel = [
    ".tools-page .tools-section-toggle",
    ".tools-page .tools-menu-item",
    ".current-card",
    ".current-stat-chip",
    ".current-forecast-btn",
    ".forecast-card",
    ".extra-info-card",
    ".fav-star-btn",
  ].join(", ");

  function bindAll() {
    document.querySelectorAll(homeSel).forEach(bindPress);
  }
  bindAll();
  // 預報小卡可能之後才渲染，定期補綁一次即可
  const mo = new MutationObserver(() => bindAll());
  const root = document.getElementById("forecastPanel") || document.body;
  try { mo.observe(root, { childList: true, subtree: true }); } catch (e) {}
})();'''

if "home-glass-bounce" in r or ".current-card" in r and "homeSel" in r:
    print("js already")
elif old in r:
    r = r.replace(old, new, 1)
    r_path.write_text(r, encoding="utf-8")
    print("js ok")
else:
    # try find forEach(bindPress) ending of initToolsGlassPress
    marker = "document.querySelectorAll(\".tools-page .tools-section-toggle, .tools-page .tools-menu-item\").forEach(bindPress);"
    if marker in r:
        r = r.replace(marker, new.replace("})();", "").strip(), 1)
        # ensure closing
        if "homeSel" in r and "})();" not in r[r.find("homeSel"):r.find("homeSel")+800]:
            pass
        r_path.write_text(r, encoding="utf-8")
        print("js soft")
    else:
        raise SystemExit("js bind site not found")

print("DONE")
