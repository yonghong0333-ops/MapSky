#!/usr/bin/env python3
from pathlib import Path
import re

JS = Path("public/web-shim.js")

NEW_FN = r'''function endLoginGateBoot(opts) {
    opts = opts || {};
    if (loginGateBootSafetyTimer) { clearTimeout(loginGateBootSafetyTimer); loginGateBootSafetyTimer = null; }
    if (loginGateWeatherTimer) { clearInterval(loginGateWeatherTimer); loginGateWeatherTimer = null; }
    const gate = el("loginGate");
    const boot = el("loginGateBoot");
    // Always force-hide the spinner overlay (was stuck over the login form)
    function hideBoot() {
      if (boot) {
        boot.classList.add("hidden");
        boot.classList.remove("login-gate-boot--exit");
      }
      if (gate) {
        gate.classList.remove("login-gate--booting");
        gate.classList.remove("login-gate--opening");
      }
    }
    // Reveal login form / leave boot: no full-gate "open" animation
    if (opts.immediate || !gate || !gate.classList.contains("login-gate--booting")) {
      hideBoot();
      return;
    }
    // Logged-in path may still play a short open animation, then hide
    if (gate.classList.contains("login-gate--opening")) {
      hideBoot();
      return;
    }
    gate.classList.add("login-gate--opening");
    if (boot) boot.classList.add("login-gate-boot--exit");
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      hideBoot();
    }
    function onEnd(e) {
      if (e && e.target !== gate) return;
      gate.removeEventListener("transitionend", onEnd);
      finish();
    }
    gate.addEventListener("transitionend", onEnd);
    setTimeout(finish, 500);
  }'''


def main():
    js = JS.read_text(encoding="utf-8")
    if "Always force-hide the spinner overlay" in js:
        print("already")
        return
    pat = re.compile(
        r"function endLoginGateBoot\(\) \{[\s\S]*?setTimeout\(finish, 700\);\s*\}",
        re.M,
    )
    m = pat.search(js)
    if not m:
        # try alternate timeout
        pat = re.compile(
            r"function endLoginGateBoot\(\) \{[\s\S]*?setTimeout\(finish, \d+\);\s*\}",
            re.M,
        )
        m = pat.search(js)
    if not m:
        raise SystemExit("endLoginGateBoot not found")
    js = js[: m.start()] + NEW_FN + js[m.end() :]

    # Not-logged-in: end boot immediately (no open animation covering the form)
    old = "// 未登入：Google／Facebook 預設顯示，其他收在「更多登入方式」（無藍底按鈕）\n    endLoginGateBoot();"
    new = "// 未登入：Google／Facebook 預設顯示，其他收在「更多登入方式」（無藍底按鈕）\n    endLoginGateBoot({ immediate: true });"
    if old in js:
        js = js.replace(old, new, 1)
        print("not-logged-in immediate")
    else:
        print("not-logged-in marker missing")

    JS.write_text(js, encoding="utf-8")
    print("patched")


if __name__ == "__main__":
    main()
