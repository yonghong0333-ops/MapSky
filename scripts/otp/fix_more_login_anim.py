#!/usr/bin/env python3
from pathlib import Path

js_path = Path("public/web-shim.js")
js = js_path.read_text(encoding="utf-8")

old = '''    if (extraEl && moreToggle && extraProviders.length > 0) {
      extraEl.innerHTML = buildGateButtons(extraProviders);
      extraEl.classList.add("hidden");
      moreToggle.classList.remove("hidden");
      moreToggle.classList.remove("expanded");
      const labelSpan = moreToggle.querySelector("span:not(.login-gate-more-chevron)") || moreToggle.querySelector("span");
      if (labelSpan) labelSpan.textContent = "更多登入方式";
      if (!moreToggle.dataset.bound) {
        moreToggle.dataset.bound = "1";
        moreToggle.addEventListener("click", () => {
          const expanded = moreToggle.classList.toggle("expanded");
          extraEl.classList.toggle("hidden", !expanded);
          const s = moreToggle.querySelector("span:not(.login-gate-more-chevron)") || moreToggle.querySelector("span");
          if (s) s.textContent = expanded ? "收起" : "更多登入方式";
        });
      }
    } else {
      if (extraEl) { extraEl.innerHTML = ""; extraEl.classList.add("hidden"); }
      if (moreToggle) moreToggle.classList.add("hidden");
    }'''

new = '''    if (extraEl && moreToggle && extraProviders.length > 0) {
      extraEl.innerHTML = buildGateButtons(extraProviders);
      // 用 is-open 做展開動畫，不再用 display:none（無法過渡）
      extraEl.classList.remove("hidden");
      extraEl.classList.remove("is-open");
      extraEl.setAttribute("aria-hidden", "true");
      moreToggle.classList.remove("hidden");
      moreToggle.classList.remove("expanded");
      moreToggle.setAttribute("aria-expanded", "false");
      const labelSpan = moreToggle.querySelector("span:not(.login-gate-more-chevron)") || moreToggle.querySelector("span");
      if (labelSpan) labelSpan.textContent = "更多登入方式";
      if (!moreToggle.dataset.bound) {
        moreToggle.dataset.bound = "1";
        moreToggle.addEventListener("click", () => {
          const expanded = moreToggle.classList.toggle("expanded");
          extraEl.classList.toggle("is-open", expanded);
          extraEl.classList.remove("hidden");
          extraEl.setAttribute("aria-hidden", expanded ? "false" : "true");
          moreToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
          const s = moreToggle.querySelector("span:not(.login-gate-more-chevron)") || moreToggle.querySelector("span");
          if (s) s.textContent = expanded ? "收起" : "更多登入方式";
        });
      }
    } else {
      if (extraEl) {
        extraEl.innerHTML = "";
        extraEl.classList.remove("is-open");
        extraEl.classList.add("hidden");
      }
      if (moreToggle) moreToggle.classList.add("hidden");
    }'''

if "extraEl.classList.toggle(\"is-open\"" in js or "extraEl.classList.toggle('is-open'" in js:
    print("js already")
elif old in js:
    js = js.replace(old, new, 1)
    print("js ok")
else:
    raise SystemExit("js block not found")

js_path.write_text(js, encoding="utf-8")

css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")

if "MORE_LOGIN_ANIM" in css:
    print("css already")
else:
    css += '''

/* MORE_LOGIN_ANIM — 更多登入方式展開／收合過渡 */
.login-gate-buttons-extra {
  display: flex !important;
  flex-direction: column;
  gap: 10px;
  margin-top: 0;
  overflow: hidden;
  max-height: 0;
  opacity: 0;
  transform: translateY(-6px);
  pointer-events: none;
  transition:
    max-height 0.38s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.28s ease,
    transform 0.32s cubic-bezier(0.4, 0, 0.2, 1),
    margin-top 0.32s ease;
}
.login-gate-buttons-extra.is-open {
  max-height: 420px;
  opacity: 1;
  transform: translateY(0);
  margin-top: 10px;
  pointer-events: auto;
}
.login-gate-buttons-extra.hidden {
  display: none !important;
}
.login-gate-more-chevron {
  transition: transform 0.32s cubic-bezier(0.4, 0, 0.2, 1) !important;
}
.login-gate-more-toggle.expanded .login-gate-more-chevron {
  transform: rotate(-135deg) !important;
}
.login-gate-buttons-extra.is-open .login-gate-btn {
  animation: more-login-btn-in 0.36s cubic-bezier(0.34, 1.2, 0.64, 1) both;
}
.login-gate-buttons-extra.is-open .login-gate-btn:nth-child(1) { animation-delay: 0.02s; }
.login-gate-buttons-extra.is-open .login-gate-btn:nth-child(2) { animation-delay: 0.06s; }
.login-gate-buttons-extra.is-open .login-gate-btn:nth-child(3) { animation-delay: 0.10s; }
.login-gate-buttons-extra.is-open .login-gate-btn:nth-child(4) { animation-delay: 0.14s; }
.login-gate-buttons-extra.is-open .login-gate-btn:nth-child(5) { animation-delay: 0.18s; }
@keyframes more-login-btn-in {
  from {
    opacity: 0;
    transform: translateY(-8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
'''
    css_path.write_text(css, encoding="utf-8")
    print("css ok")

print("DONE")
