#!/usr/bin/env python3
from pathlib import Path

# --- Restore expand/collapse in web-shim.js ---
js_path = Path("public/web-shim.js")
js = js_path.read_text(encoding="utf-8")

old = '''    // 未登入：把主畫面繼續擋著，只在登入畫面上顯示全部登入方式（不再用「更多／收起」）。
    endLoginGateBoot();
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.classList.remove("login-gate-status--loading");
    }
    // 順序：Google、Facebook 在前，其餘照 providers 原順序接在後面
    const primaryIds = ["google", "facebook"];
    const primaryProviders = (providers || []).filter((p) => primaryIds.includes(p.id));
    const extraProviders = (providers || []).filter((p) => !primaryIds.includes(p.id));
    const allProviders = primaryProviders.concat(extraProviders);
    if (buttonsEl) {
      buttonsEl.innerHTML = buildGateButtons(allProviders);
      buttonsEl.classList.remove("hidden");
    }
    const extraEl = el("loginGateButtonsExtra");
    const moreToggle = el("loginGateMoreToggle");
    if (extraEl) {
      extraEl.innerHTML = "";
      extraEl.classList.add("hidden");
    }
    if (moreToggle) moreToggle.classList.add("hidden");
    initMagicLinkForm();
    maybeOpenOtpFromQuery();
  }'''

new = '''    // 未登入：Google／Facebook 預設顯示，其他收在「更多登入方式」（無藍底按鈕）
    endLoginGateBoot();
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.classList.remove("login-gate-status--loading");
    }
    const primaryIds = ["google", "facebook"];
    const primaryProviders = (providers || []).filter((p) => primaryIds.includes(p.id));
    const extraProviders = (providers || []).filter((p) => !primaryIds.includes(p.id));
    if (buttonsEl) {
      buttonsEl.innerHTML = buildGateButtons(primaryProviders);
      buttonsEl.classList.remove("hidden");
    }
    const extraEl = el("loginGateButtonsExtra");
    const moreToggle = el("loginGateMoreToggle");
    if (extraEl && moreToggle && extraProviders.length > 0) {
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
    }
    initMagicLinkForm();
    maybeOpenOtpFromQuery();
  }'''

if "無藍底按鈕" in js:
    print("js already")
elif old in js:
    js = js.replace(old, new, 1)
    print("js restored")
elif "顯示全部登入方式，不再使用" in js:
    start = js.find("    // 顯示全部登入方式，不再使用")
    if start < 0:
        start = js.find('    const primaryIds = ["google", "facebook"];')
    end = js.find("    initMagicLinkForm();", start if start >= 0 else 0)
    if start < 0 or end < 0:
        raise SystemExit("soft bounds missing")
    replacement = new[new.find("    // 未登入"):new.rfind("initMagicLinkForm();")]
    # use the body only
    body = new.split("initMagicLinkForm()")[0]
    # strip leading comment through last line before initMagicLinkForm in new
    lines = []
    for line in new.splitlines():
        if line.strip().startswith("initMagicLinkForm"):
            break
        lines.append(line)
    replacement = "\n".join(lines) + "\n"
    js = js[:start] + replacement + js[end:]
    print("js soft restored")
else:
    raise SystemExit("js pattern not found")

js_path.write_text(js, encoding="utf-8")

# --- CSS: force no blue background, even on iOS / expanded ---
css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")

marker = ".login-gate-more-toggle {"
if "login-gate-more-toggle-no-blue" in css:
    print("css already")
else:
    extra = """
/* 更多／收起：文字按鈕，不要藍底（避免 iOS 預設 button 樣式） */
.login-gate-more-toggle,
.login-gate-more-toggle.expanded,
.login-gate-more-toggle:active,
.login-gate-more-toggle:focus,
.login-gate-more-toggle:hover {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  border: none !important;
  box-shadow: none !important;
  color: var(--text-muted) !important;
  -webkit-appearance: none;
  appearance: none;
}
"""
    css += extra
    css_path.write_text(css, encoding="utf-8")
    print("css ok")

print("DONE")
