#!/usr/bin/env python3
from pathlib import Path
import base64

parts = []
for i in range(4):
    p = Path(f"scripts/otp/login_bg_part_{i}.txt")
    if not p.exists():
        raise SystemExit(f"missing {p}")
    parts.append(p.read_text().strip())
Path("public/login-bg.jpg").write_bytes(base64.b64decode("".join(parts)))
print("bg", Path("public/login-bg.jpg").stat().st_size)

p = Path("public/index.html")
t = p.read_text(encoding="utf-8")
old = """    <div class=\"login-gate-card\">
      <img class=\"login-gate-logo\" src=\"icons/logo-dark.png\" alt=\"MapSky\" />
      <h1 class=\"login-gate-title\">MapSky</h1>
      <p class=\"login-gate-tagline\">看見天氣，連結你的每一刻</p>"""
new = """    <div class=\"login-gate-card login-gate-card--flat\">
      <h1 class=\"login-gate-title login-gate-title--terminal\" id=\"loginGateTitle\" aria-label=\"MapSky\">
        <span class=\"login-gate-terminal-prefix\" aria-hidden=\"true\">&gt; </span><span id=\"loginGateTitleTyped\" class=\"login-gate-title-typed\"></span><span class=\"login-gate-cursor\" aria-hidden=\"true\">\u2588</span>
      </h1>
      <p class=\"login-gate-tagline\">看見天氣，連結你的每一刻</p>"""
if "login-gate-title--terminal" in t:
    print("html already")
elif old in t:
    p.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("html ok")
else:
    raise SystemExit("html block not found")

css = Path("public/style.css")
c = css.read_text(encoding="utf-8")
if "LOGIN_FLAT_BG_TERMINAL" not in c:
    c += """

/* LOGIN_FLAT_BG_TERMINAL */
.login-gate {
  background:
    linear-gradient(180deg, rgba(8, 18, 40, 0.22) 0%, rgba(8, 18, 40, 0.4) 100%),
    url("login-bg.jpg") center / cover no-repeat !important;
  background-color: #0a1a2e !important;
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
