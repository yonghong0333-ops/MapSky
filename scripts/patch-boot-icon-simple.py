#!/usr/bin/env python3
from pathlib import Path
import re

def main():
    idx = Path("public/index.html")
    h = idx.read_text(encoding="utf-8")
    pat = re.compile(
        r"(<div class=\"login-gate-boot-weather\">)[\\s\\S]*?(</div>\\s*</div>\\s*<p class=\"login-gate-boot-text\")",
        re.M,
    )
    # fix double escapes - use real pattern
    pat = re.compile(
        r'(<div class="login-gate-boot-weather">)[\s\S]*?(</div>\s*</div>\s*<p class="login-gate-boot-text")',
        re.M,
    )
    m = pat.search(h)
    if not m:
        raise SystemExit("no match")
    if "icons/icon-192.png" in m.group(0):
        print("already")
        return
    repl = (
        m.group(1)
        + '\n          <img class="login-gate-boot-wx is-active login-gate-boot-logo" '
        + 'src="icons/icon-192.png" alt="MapSky" />\n        '
        + m.group(2)
    )
    h = h[: m.start()] + repl + h[m.end() :]
    idx.write_text(h, encoding="utf-8")
    print("index patched")

    css_path = Path("public/style.css")
    css = css_path.read_text(encoding="utf-8")
    if "BOOT_LOGO_ICON" not in css:
        css_path.write_text(
            css.rstrip()
            + """

/* BOOT_LOGO_ICON */
.login-gate-boot-weather .login-gate-boot-logo {
  width: 72px !important;
  height: 72px !important;
  border-radius: 18px !important;
  opacity: 1 !important;
  transform: none !important;
  object-fit: contain !important;
}
.login-gate-boot-weather {
  width: 72px !important;
  height: 72px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}
""",
            encoding="utf-8",
        )
        print("css patched")

    cb = Path("api/auth/callback.js")
    c = cb.read_text(encoding="utf-8")
    old = '<div class="orbit" aria-hidden="true"><span class="ring"></span><div class="sun"></div></div>'
    new = '<div class="orbit" aria-hidden="true"><span class="ring"></span><img class="logo" src="/icons/icon-192.png" alt="MapSky" width="52" height="52"/></div>'
    if old in c:
        c = c.replace(old, new, 1)
        cb.write_text(c, encoding="utf-8")
        print("callback patched")

if __name__ == "__main__":
    main()
