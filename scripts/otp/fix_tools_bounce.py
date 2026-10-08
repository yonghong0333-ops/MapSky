#!/usr/bin/env python3
from pathlib import Path

css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")

if "tools-glass-bounce" in css:
    print("css already")
else:
    css += '''

/* tools-glass-bounce: 點擊回彈 + 白色光效 */
.tools-page .tools-section {
  position: relative;
  transition: transform 0.28s cubic-bezier(0.34, 1.45, 0.64, 1), box-shadow 0.25s ease;
}
.tools-page .tools-section-toggle {
  position: relative;
  overflow: hidden;
  transition: transform 0.28s cubic-bezier(0.34, 1.45, 0.64, 1);
}
.tools-page .tools-section-toggle::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(circle at var(--ripple-x, 50%) var(--ripple-y, 50%),
    rgba(255, 255, 255, 0.65) 0%,
    rgba(255, 255, 255, 0.2) 35%,
    transparent 70%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.35s ease;
}
.tools-page .tools-section-toggle.is-pressing {
  transform: scale(0.97);
}
.tools-page .tools-section-toggle.is-pressing::after {
  opacity: 1;
}
.tools-page .tools-section-toggle.is-bounce {
  animation: tools-glass-bounce 0.45s cubic-bezier(0.34, 1.45, 0.64, 1);
}
.tools-page .tools-section-toggle.is-flash::after {
  animation: tools-glass-flash 0.55s ease-out;
}

.tools-page .tools-menu-item {
  position: relative;
  overflow: hidden;
  transition:
    transform 0.32s cubic-bezier(0.34, 1.45, 0.64, 1),
    box-shadow 0.25s ease,
    border-color 0.2s ease !important;
}
.tools-page .tools-menu-item::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(circle at var(--ripple-x, 50%) var(--ripple-y, 50%),
    rgba(255, 255, 255, 0.75) 0%,
    rgba(255, 255, 255, 0.28) 40%,
    transparent 72%);
  opacity: 0;
  pointer-events: none;
  z-index: 1;
}
.tools-page .tools-menu-item > * {
  position: relative;
  z-index: 2;
}
.tools-page .tools-menu-item.is-pressing {
  transform: scale(0.94) !important;
  box-shadow:
    0 2px 8px rgba(30, 60, 120, 0.12),
    inset 0 0 20px rgba(255, 255, 255, 0.45) !important;
}
.tools-page .tools-menu-item.is-pressing::after {
  opacity: 1;
}
.tools-page .tools-menu-item.is-bounce {
  animation: tools-glass-bounce 0.48s cubic-bezier(0.34, 1.45, 0.64, 1);
}
.tools-page .tools-menu-item.is-flash::after {
  animation: tools-glass-flash 0.55s ease-out;
}

@keyframes tools-glass-bounce {
  0%   { transform: scale(0.94); }
  55%  { transform: scale(1.04); }
  75%  { transform: scale(0.99); }
  100% { transform: scale(1); }
}
@keyframes tools-glass-flash {
  0%   { opacity: 0.9; }
  40%  { opacity: 0.55; }
  100% { opacity: 0; }
}
'''
    css_path.write_text(css, encoding="utf-8")
    print("css ok")

# JS for press tracking
r_path = Path("public/renderer.js")
r = r_path.read_text(encoding="utf-8")
if "initToolsGlassPress" in r:
    print("js already")
else:
    snippet = '''
// 工具玻璃卡：按下縮小 + 白色光暈，鬆開回彈
(function initToolsGlassPress() {
  function bindPress(el) {
    if (!el || el.dataset.glassPressBound) return;
    el.dataset.glassPressBound = "1";
    const setRipple = (e) => {
      const rect = el.getBoundingClientRect();
      const t = (e.touches && e.touches[0]) || e;
      const x = ((t.clientX - rect.left) / rect.width) * 100;
      const y = ((t.clientY - rect.top) / rect.height) * 100;
      el.style.setProperty("--ripple-x", x + "%");
      el.style.setProperty("--ripple-y", y + "%");
    };
    const down = (e) => {
      setRipple(e);
      el.classList.remove("is-bounce", "is-flash");
      el.classList.add("is-pressing");
    };
    const up = () => {
      if (!el.classList.contains("is-pressing")) return;
      el.classList.remove("is-pressing");
      void el.offsetWidth;
      el.classList.add("is-bounce", "is-flash");
      window.setTimeout(() => {
        el.classList.remove("is-bounce", "is-flash");
      }, 520);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", () => {
      if (el.classList.contains("is-pressing")) {
        el.classList.remove("is-pressing");
      }
    });
  }
  document.querySelectorAll(".tools-page .tools-section-toggle, .tools-page .tools-menu-item").forEach(bindPress);
})();
'''
    if "initToolsSectionCollapse" in r:
        r = r.replace(
            "(function initToolsSectionCollapse() {",
            snippet + "\n(function initToolsSectionCollapse() {",
            1,
        )
        print("js near collapse")
    else:
        r = r + "\n" + snippet
        print("js append")
    r_path.write_text(r, encoding="utf-8")

print("DONE")
