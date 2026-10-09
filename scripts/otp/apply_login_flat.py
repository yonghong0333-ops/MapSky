#!/usr/bin/env python3
from pathlib import Path
import re

p = Path("public/index.html")
t = p.read_text(encoding="utf-8")

if "login-gate-title--terminal" in t:
    print("html already")
else:
    pat = re.compile(
        r'(<div class="login-gate-card">)\s*'
        r'<img class="login-gate-logo"[^>]*>\s*'
        r'<h1 class="login-gate-title">MapSky</h1>',
        re.M,
    )
    cursor = chr(0x2588)
    repl = (
        '<div class="login-gate-card login-gate-card--flat">\n'
        '      <h1 class="login-gate-title login-gate-title--terminal" id="loginGateTitle" aria-label="MapSky">\n'
        '        <span class="login-gate-terminal-prefix" aria-hidden="true">&gt; </span>'
        '<span id="loginGateTitleTyped" class="login-gate-title-typed"></span>'
        f'<span class="login-gate-cursor" aria-hidden="true">{cursor}</span>\n'
        '      </h1>'
    )
    t2, n = pat.subn(lambda m: repl, t, count=1)
    if n != 1:
        raise SystemExit(f"html block not found (n={n})")
    p.write_text(t2, encoding="utf-8")
    print("html ok")

css = Path("public/style.css")
c = css.read_text(encoding="utf-8")
if "LOGIN_FLAT_BG_TERMINAL" not in c:
    c += """

/* LOGIN_FLAT_BG_TERMINAL */
.login-gate {
  background:
    linear-gradient(180deg, rgba(8, 18, 40, 0.2) 0%, rgba(8, 18, 40, 0.45) 100%),
    url("login-bg.jpg") center / cover no-repeat,
    linear-gradient(165deg, #7eb6e8 0%, #a8c8e8 35%, #c5d4e0 55%, #8fa8bc 75%, #6a8499 100%) !important;
  background-color: #7eb6e8 !important;
}
.login-gate-card,
.login-gate-card.login-gate-card--flat {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  width: min(100%, 400px) !important;
  padding: 28px 22px 32px !important;
  overflow: visible !important;
}
.login-gate-card::before,
.login-gate-card::after {
  display: none !important;
  content: none !important;
}
.login-gate-logo { display: none !important; }
.login-gate-title--terminal,
.login-gate-title {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
  font-size: 34px !important;
  font-weight: 700 !important;
  letter-spacing: 0.08em !important;
  color: #f2f7ff !important;
  text-align: left !important;
  text-shadow: 0 0 18px rgba(92, 225, 255, 0.35), 0 2px 8px rgba(0,0,0,0.35) !important;
  margin: 0 0 8px !important;
  min-height: 1.2em;
}
.login-gate-terminal-prefix { color: #5ce1ff; opacity: 0.9; }
.login-gate-cursor {
  display: inline-block;
  margin-left: 2px;
  color: #5ce1ff;
  animation: login-cursor-blink 1s steps(1) infinite;
}
@keyframes login-cursor-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
.login-gate-tagline {
  color: rgba(242, 247, 255, 0.72) !important;
  text-align: left !important;
  margin-bottom: 28px !important;
}
.login-gate-more-toggle,
.login-gate-divider { color: rgba(242, 247, 255, 0.55) !important; }
.login-gate-divider::before,
.login-gate-divider::after {
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent) !important;
}
"""
    css.write_text(c, encoding="utf-8")
    print("css ok")
else:
    print("css already")

js = Path("public/web-shim.js")
j = js.read_text(encoding="utf-8")
if "LOGIN_TERMINAL_TYPE" not in j:
    j += """
/* LOGIN_TERMINAL_TYPE */
(function () {
  function runType() {
    var el = document.getElementById("loginGateTitleTyped");
    if (!el) return;
    if (el.dataset.typing === "1") return;
    el.dataset.typing = "1";
    var text = "MapSky";
    var i = 0;
    el.textContent = "";
    function tick() {
      if (i <= text.length) {
        el.textContent = text.slice(0, i);
        i += 1;
        setTimeout(tick, 110);
      } else {
        el.dataset.typing = "0";
        el.dataset.done = "1";
      }
    }
    setTimeout(tick, 200);
  }
  function tryType() {
    var gate = document.getElementById("loginGate");
    if (gate && gate.classList.contains("login-gate--booting")) return;
    runType();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tryType);
  else tryType();
  var gate = document.getElementById("loginGate");
  if (gate) {
    new MutationObserver(function () {
      if (!gate.classList.contains("login-gate--booting")) {
        var el = document.getElementById("loginGateTitleTyped");
        if (el && el.dataset.done !== "1") runType();
      }
    }).observe(gate, { attributes: true, attributeFilter: ["class"] });
  }
})();
"""
    js.write_text(j, encoding="utf-8")
    print("js ok")
else:
    print("js already")
print("DONE")
