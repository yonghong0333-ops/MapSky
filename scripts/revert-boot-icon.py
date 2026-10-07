#!/usr/bin/env python3
from pathlib import Path
import re

IDX = Path("public/index.html")
CSS = Path("public/style.css")

OLD_WEATHER = '''        <div class="login-gate-boot-weather">
          <img class="login-gate-boot-wx is-active login-gate-boot-logo" src="icons/icon-192.png" alt="MapSky" />
        </div>'''

NEW_WEATHER = '''        <div class="login-gate-boot-weather">
        <img class="login-gate-boot-wx is-active" src="icons/sunny.png" alt="" data-wx="sunny" />
        <img class="login-gate-boot-wx" src="icons/partly-cloudy.png" alt="" data-wx="partly" />
        <img class="login-gate-boot-wx" src="icons/overcast.png" alt="" data-wx="overcast" />
        <img class="login-gate-boot-wx" src="icons/drizzle.png" alt="" data-wx="drizzle" />
        <img class="login-gate-boot-wx" src="icons/rain.png" alt="" data-wx="rain" />
        <img class="login-gate-boot-wx" src="icons/thunderstorm.png" alt="" data-wx="storm" />
      </div>'''


def main():
    h = IDX.read_text(encoding="utf-8")
    if "icons/sunny.png" in h and "loginGateBoot" in h:
        # still may have icon-192 only
        pass
    if OLD_WEATHER in h:
        h = h.replace(OLD_WEATHER, NEW_WEATHER, 1)
        IDX.write_text(h, encoding="utf-8")
        print("index reverted")
    elif "icons/icon-192.png" in h[h.find("loginGateBoot") : h.find("loginGateBoot") + 600]:
        pat = re.compile(
            r'<div class="login-gate-boot-weather">[\s\S]*?</div>',
            re.M,
        )

        def repl(m):
            if "loginGateBoot" not in h[max(0, m.start() - 200) : m.start()]:
                return m.group(0)
            return NEW_WEATHER.strip()

        # only first weather block near boot
        m = pat.search(h, h.find("loginGateBoot"))
        if not m:
            raise SystemExit("weather block not found")
        h = h[: m.start()] + NEW_WEATHER.strip() + h[m.end() :]
        IDX.write_text(h, encoding="utf-8")
        print("index reverted via regex")
    else:
        print("index already weather icons")

    css = CSS.read_text(encoding="utf-8")
    if "/* BOOT_LOGO_ICON */" in css:
        css = re.sub(
            r"\n*/\* BOOT_LOGO_ICON \*/[\s\S]*?justify-content: center !important;\n\}\n?",
            "\n",
            css,
            count=1,
        )
        CSS.write_text(css, encoding="utf-8")
        print("css cleaned")
    else:
        print("css no BOOT_LOGO block")


if __name__ == "__main__":
    main()
