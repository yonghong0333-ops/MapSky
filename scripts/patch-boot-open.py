#!/usr/bin/env python3
"""Patch endLoginGateBoot to play an open animation; append CSS."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
JS_PATH = ROOT / "public" / "web-shim.js"
CSS_PATH = ROOT / "public" / "style.css"

NEW_FN = '''function endLoginGateBoot() {
    if (loginGateBootSafetyTimer) { clearTimeout(loginGateBootSafetyTimer); loginGateBootSafetyTimer = null; }
    if (loginGateWeatherTimer) { clearInterval(loginGateWeatherTimer); loginGateWeatherTimer = null; }
    const gate = el("loginGate");
    const boot = el("loginGateBoot");
    if (!gate || !gate.classList.contains("login-gate--booting")) {
      if (boot) boot.classList.add("hidden");
      return;
    }
    if (gate.classList.contains("login-gate--opening")) return;
    gate.classList.add("login-gate--opening");
    if (boot) boot.classList.add("login-gate-boot--exit");
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      gate.classList.remove("login-gate--booting");
      gate.classList.remove("login-gate--opening");
      if (boot) {
        boot.classList.add("hidden");
        boot.classList.remove("login-gate-boot--exit");
      }
    }
    function onEnd(e) {
      if (e && e.target !== gate) return;
      gate.removeEventListener("transitionend", onEnd);
      finish();
    }
    gate.addEventListener("transitionend", onEnd);
    setTimeout(finish, 700);
  }'''

ANIM = '''

/* BOOT_OPEN_ANIM */
.login-gate.login-gate--booting.login-gate--opening {
  animation: loginGateOpen 0.62s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  pointer-events: none;
}
@keyframes loginGateOpen {
  0% { opacity: 1; transform: scale(1); filter: blur(0); }
  55% { opacity: 0.85; transform: scale(1.04); filter: blur(0); }
  100% { opacity: 0; transform: scale(1.12); filter: blur(6px); }
}
.login-gate-boot.login-gate-boot--exit .login-gate-boot-orbit-wrap {
  animation: bootOrbitExpand 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
.login-gate-boot.login-gate-boot--exit .login-gate-boot-text {
  animation: bootTextFade 0.35s ease forwards;
}
.login-gate-boot.login-gate-boot--exit .login-gate-boot-orbit-ring {
  animation: bootRingExpand 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
@keyframes bootOrbitExpand {
  0% { transform: scale(1); opacity: 1; }
  100% { transform: scale(1.55); opacity: 0; }
}
@keyframes bootRingExpand {
  0% { transform: scale(1); opacity: 1; border-width: 3px; }
  100% { transform: scale(1.8); opacity: 0; border-width: 1px; }
}
@keyframes bootTextFade {
  0% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(8px); }
}
'''

def main():
    js = JS_PATH.read_text(encoding="utf-8")
    if "login-gate--opening" in js and "login-gate-boot--exit" in js:
        print("JS already patched")
    else:
        # Flexible match for the short original function body
        pat = re.compile(
            r"function endLoginGateBoot\(\) \{[\s\S]*?if \(boot\) boot\.classList\.add\(\"hidden\"\);\s*\}",
            re.M,
        )
        m = pat.search(js)
        if not m:
            raise SystemExit("endLoginGateBoot not found")
        js2 = js[: m.start()] + NEW_FN + js[m.end() :]
        JS_PATH.write_text(js2, encoding="utf-8")
        print("patched web-shim.js", m.start(), "->", len(NEW_FN))

    css = CSS_PATH.read_text(encoding="utf-8")
    if "BOOT_OPEN_ANIM" in css:
        print("CSS already has BOOT_OPEN_ANIM")
    else:
        CSS_PATH.write_text(css.rstrip() + ANIM, encoding="utf-8")
        print("appended boot open CSS")

if __name__ == "__main__":
    main()
