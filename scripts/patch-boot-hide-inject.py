#!/usr/bin/env python3
from pathlib import Path

JS = Path("public/web-shim.js")

INJECT = '''
  // Force-hide boot overlay whenever login form is shown (not booting)
  (function injectBootHideCss() {
    if (document.getElementById("mapsky-boot-hide-css")) return;
    var s = document.createElement("style");
    s.id = "mapsky-boot-hide-css";
    s.textContent = ".login-gate:not(.login-gate--booting) .login-gate-boot{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}.login-gate-boot.hidden{display:none!important}";
    (document.head || document.documentElement).appendChild(s);
  })();
'''


def main():
    js = JS.read_text(encoding="utf-8")
    if "mapsky-boot-hide-css" in js:
        print("already")
        return

    # Inject near top of IIFE after first few lines
    anchor = "const isNativeShell"
    if anchor not in js:
        anchor = "function el("
    if anchor not in js:
        raise SystemExit("no inject anchor")
    pos = js.find(anchor)
    js = js[:pos] + INJECT + "\n  " + js[pos:]

    needle = "// \u672a\u767b\u5165\uff1aGoogle\uff0fFacebook \u9810\u8a2d\u986f\u793a\uff0c\u5176\u4ed6\u6536\u5728\u300c\u66f4\u591a\u767b\u5165\u65b9\u5f0f\u300d\uff08\u7121\u85cd\u5e95\u6309\u9215\uff09\n    endLoginGateBoot();"
    # real utf-8
    needle = "// 未登入：Google／Facebook 預設顯示，其他收在「更多登入方式」（無藍底按鈕）\n    endLoginGateBoot();"
    extra = needle + """
    {
      const b = el("loginGateBoot");
      if (b) b.classList.add("hidden");
      const g = el("loginGate");
      if (g) {
        g.classList.remove("login-gate--booting");
        g.classList.remove("login-gate--opening");
      }
    }"""
    if needle in js:
        js = js.replace(needle, extra, 1)
        print("reinforced not-logged-in")
    else:
        print("needle missing")

    JS.write_text(js, encoding="utf-8")
    print("done", "mapsky-boot-hide-css" in JS.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
