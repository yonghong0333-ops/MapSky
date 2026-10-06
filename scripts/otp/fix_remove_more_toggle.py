#!/usr/bin/env python3
from pathlib import Path

js_path = Path("public/web-shim.js")
js = js_path.read_text(encoding="utf-8")

old = '''    // 未登入：把主畫面繼續擋著，只在登入畫面上顯示可用的登入方式。
    // 預設只露出 Google／Facebook 兩個，其他的收起來，點「更多登入方式」
    // 才展開——同一批 providers，只是依 id 分成兩組渲染，按鈕本身
    // （buildGateButtons）完全沒變。
    endLoginGateBoot();
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.classList.remove("login-gate-status--loading");
    }
    const primaryIds = ["google", "facebook"];
    const primaryProviders = providers.filter((p) => primaryIds.includes(p.id));
    const extraProviders = providers.filter((p) => !primaryIds.includes(p.id));
    if (buttonsEl) {
      buttonsEl.innerHTML = buildGateButtons(primaryProviders);
      buttonsEl.classList.remove("hidden");
    }
    const extraEl = el("loginGateButtonsExtra");
    const moreToggle = el("loginGateMoreToggle");
    if (extraEl && moreToggle && extraProviders.length > 0) {
      extraEl.innerHTML = buildGateButtons(extraProviders);
      moreToggle.classList.remove("hidden");
      if (!moreToggle.dataset.bound) {
        moreToggle.dataset.bound = "1";
        moreToggle.addEventListener("click", () => {
          const expanded = moreToggle.classList.toggle("expanded");
          extraEl.classList.toggle("hidden", !expanded);
          moreToggle.querySelector("span").textContent = expanded ? "收起" : "更多登入方式";
        });
      }
    }
    initMagicLinkForm();
    maybeOpenOtpFromQuery();
  }'''

new = '''    // 未登入：把主畫面繼續擋著，只在登入畫面上顯示全部登入方式（不再用「更多／收起」）。
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

if "不再用「更多／收起」" in js:
    print("js already")
elif old in js:
    js = js.replace(old, new, 1)
    print("js ok")
else:
    # softer: just force all providers and hide toggle
    if 'const primaryIds = ["google", "facebook"];' in js:
        # replace from primaryIds through moreToggle block end
        start = js.find('    const primaryIds = ["google", "facebook"];')
        end = js.find("    initMagicLinkForm();", start)
        if start < 0 or end < 0:
            raise SystemExit("block bounds not found")
        replacement = (
            "    // 顯示全部登入方式，不再使用「更多／收起」藍鈕\n"
            "    const primaryIds = [\"google\", \"facebook\"];\n"
            "    const primaryProviders = (providers || []).filter((p) => primaryIds.includes(p.id));\n"
            "    const extraProviders = (providers || []).filter((p) => !primaryIds.includes(p.id));\n"
            "    const allProviders = primaryProviders.concat(extraProviders);\n"
            "    if (buttonsEl) {\n"
            "      buttonsEl.innerHTML = buildGateButtons(allProviders);\n"
            "      buttonsEl.classList.remove(\"hidden\");\n"
            "    }\n"
            "    const extraEl = el(\"loginGateButtonsExtra\");\n"
            "    const moreToggle = el(\"loginGateMoreToggle\");\n"
            "    if (extraEl) { extraEl.innerHTML = \"\"; extraEl.classList.add(\"hidden\"); }\n"
            "    if (moreToggle) moreToggle.classList.add(\"hidden\");\n"
        )
        js = js[:start] + replacement + js[end:]
        print("js soft ok")
    else:
        raise SystemExit("primaryIds not found")

js_path.write_text(js, encoding="utf-8")
print("DONE")
