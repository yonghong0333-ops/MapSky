#!/usr/bin/env python3
from pathlib import Path
import re

js = Path("public/web-shim.js")
j = js.read_text(encoding="utf-8")

# Remove old terminal + tagline IIFEs
j2 = re.sub(
    r"\n/\* LOGIN_TERMINAL_TYPE \*/\n\(function \(\) \{[\s\S]*?\}\)\(\);\n",
    "\n",
    j,
    count=1,
)
j2 = re.sub(
    r"\n/\* LOGIN_TAGLINE_TYPE \*/\n\(function \(\) \{[\s\S]*?\}\)\(\);\s*\Z",
    "\n",
    j2,
    count=1,
)
# also if tagline not at end
j2 = re.sub(
    r"\n/\* LOGIN_TAGLINE_TYPE \*/\n\(function \(\) \{[\s\S]*?\}\)\(\);\n",
    "\n",
    j2,
    count=1,
)

unified = r'''
/* LOGIN_TERMINAL_CHAIN — 先打 MapSky，再打副標題 */
(function () {
  function typeText(el, text, speed, done) {
    if (!el) { if (done) done(); return; }
    if (el.dataset.typing === "1") return;
    el.dataset.typing = "1";
    el.dataset.done = "0";
    var i = 0;
    el.textContent = "";
    function tick() {
      if (i <= text.length) {
        el.textContent = text.slice(0, i);
        i += 1;
        setTimeout(tick, speed || 80);
      } else {
        el.dataset.typing = "0";
        el.dataset.done = "1";
        if (done) done();
      }
    }
    tick();
  }

  function runChain() {
    var gate = document.getElementById("loginGate");
    if (gate && gate.classList.contains("login-gate--booting")) return;
    var title = document.getElementById("loginGateTitleTyped");
    var tag = document.getElementById("loginGateTaglineTyped");
    if (!title && !tag) return;

    // 標題已完成但副標題還沒 → 只打副標題
    if (title && title.dataset.done === "1") {
      if (tag && tag.dataset.done !== "1" && tag.dataset.typing !== "1") {
        typeText(tag, "掌控天後，連動生活", 70);
      }
      return;
    }
    // 標題進行中 → 等它自己跑完（由 observer 再觸發）
    if (title && title.dataset.typing === "1") return;

    // 從頭：先標題再副標題
    if (title && title.dataset.done !== "1") {
      typeText(title, "MapSky", 100, function () {
        typeText(tag, "掌控天後，連動生活", 70);
      });
    } else if (tag && tag.dataset.done !== "1") {
      typeText(tag, "掌控天後，連動生活", 70);
    }
  }

  function schedule() {
    setTimeout(runChain, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", schedule);
  } else {
    schedule();
  }

  var gate = document.getElementById("loginGate");
  if (gate) {
    new MutationObserver(function () {
      if (!gate.classList.contains("login-gate--booting")) schedule();
    }).observe(gate, { attributes: true, attributeFilter: ["class"] });
  }

  // 保險：3 秒後若副標題仍空，直接寫上
  setTimeout(function () {
    var tag = document.getElementById("loginGateTaglineTyped");
    if (tag && !tag.textContent) {
      tag.textContent = "掌控天後，連動生活";
      tag.dataset.done = "1";
    }
    var title = document.getElementById("loginGateTitleTyped");
    if (title && !title.textContent) {
      title.textContent = "MapSky";
      title.dataset.done = "1";
    }
  }, 3500);
})();
'''

if "LOGIN_TERMINAL_CHAIN" not in j2:
    j2 = j2.rstrip() + "\n" + unified
    print("unified appended")
else:
    print("already has chain")

js.write_text(j2, encoding="utf-8")
print("DONE")
