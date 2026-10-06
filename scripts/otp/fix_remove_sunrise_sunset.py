#!/usr/bin/env python3
from pathlib import Path
import re

html_path = Path("public/index.html")
html = html_path.read_text(encoding="utf-8")

changed = 0
for name in ("sunrise.png", "sunset.png"):
    # remove entire img tags that reference these icons in boot weather
    pattern = rf'\s*<img class="login-gate-boot-wx"[^>]*src="icons/{re.escape(name)}"[^>]*/?>'
    html2, n = re.subn(pattern, "", html)
    if n:
        html = html2
        changed += n
        print(f"removed {name} x{n}")

if changed == 0:
    # try without self-close
    for name in ("sunrise.png", "sunset.png"):
        pattern = rf'\s*<img class="login-gate-boot-wx"[^>]*src="icons/{re.escape(name)}"[^>]*>'
        html2, n = re.subn(pattern, "", html)
        if n:
            html = html2
            changed += n
            print(f"removed alt {name} x{n}")

if changed == 0:
    if "icons/sunrise.png" not in html and "icons/sunset.png" not in html:
        print("already removed")
    else:
        # still present somewhere - only strip inside boot weather section
        start = html.find('class="login-gate-boot-weather"')
        if start < 0:
            raise SystemExit("boot weather not found")
        end = html.find("</div>", start)
        section = html[start:end]
        section2 = re.sub(r'\s*<img[^>]*icons/sunrise\.png[^>]*>', "", section)
        section2 = re.sub(r'\s*<img[^>]*icons/sunset\.png[^>]*>', "", section2)
        if section2 == section:
            raise SystemExit("could not remove sunrise/sunset")
        html = html[:start] + section2 + html[end:]
        print("removed via section")
else:
    html_path.write_text(html, encoding="utf-8")
    print("html written")

# ensure write if section path
if "icons/sunrise.png" in Path("public/index.html").read_text(encoding="utf-8") or "icons/sunset.png" in Path("public/index.html").read_text(encoding="utf-8"):
    # check only in boot - if still in boot, fail
    t = Path("public/index.html").read_text(encoding="utf-8") if changed == 0 else html
    if changed:
        Path("public/index.html").write_text(html, encoding="utf-8")
    boot = t[t.find("login-gate-boot"):t.find("login-gate-boot-text") if "login-gate-boot-text" in t else t.find("login-gate-boot")+2000]
    if "sunrise.png" in boot or "sunset.png" in boot:
        Path("public/index.html").write_text(html, encoding="utf-8")

# final write
Path("public/index.html").write_text(
    html if changed or "login-gate-boot-weather" in html else Path("public/index.html").read_text(encoding="utf-8"),
    encoding="utf-8",
)
# Always write the processed html
Path("public/index.html").write_text(html, encoding="utf-8")

final = Path("public/index.html").read_text(encoding="utf-8")
boot_start = final.find("loginGateBoot")
boot_end = final.find("login-gate-boot-text", boot_start)
boot_chunk = final[boot_start:boot_end] if boot_start >= 0 and boot_end > boot_start else ""
if "sunrise.png" in boot_chunk or "sunset.png" in boot_chunk:
    raise SystemExit("still present in boot")
print("OK - sunrise/sunset removed from boot cycle")
