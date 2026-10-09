#!/usr/bin/env python3
from pathlib import Path

css = Path("public/style.css")
c = css.read_text(encoding="utf-8")
changed = False
if "rgba(8, 18, 40, 0.2)" in c or "rgba(8, 18, 40, 0.45)" in c:
    c = c.replace(
        "linear-gradient(180deg, rgba(8, 18, 40, 0.2) 0%, rgba(8, 18, 40, 0.45) 100%),",
        "linear-gradient(180deg, rgba(0, 0, 0, 0.04) 0%, rgba(0, 0, 0, 0.06) 100%),",
    )
    changed = True
if 'url("login-bg.jpg") center / cover no-repeat,\n    linear-gradient(165deg' in c:
    c = c.replace(
        'url("login-bg.jpg") center / cover no-repeat,\n    linear-gradient(165deg, #7eb6e8 0%, #a8c8e8 35%, #c5d4e0 55%, #8fa8bc 75%, #6a8499 100%) !important;',
        'url("login-bg.jpg") center / cover no-repeat !important;',
    )
    changed = True
# also one-line form
c2 = c.replace(
    'url("login-bg.jpg") center / cover no-repeat, linear-gradient(165deg, #7eb6e8 0%, #a8c8e8 35%, #c5d4e0 55%, #8fa8bc 75%, #6a8499 100%) !important;',
    'url("login-bg.jpg") center / cover no-repeat !important;',
)
if c2 != c:
    c = c2
    changed = True
if changed:
    css.write_text(c, encoding="utf-8")
    print("fog cleared")
else:
    print("no fog pattern found")
print("DONE")
