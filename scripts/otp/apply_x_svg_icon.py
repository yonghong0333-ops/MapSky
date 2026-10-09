#!/usr/bin/env python3
from pathlib import Path

shim = Path("public/web-shim.js")
s = shim.read_text(encoding="utf-8")

X_SVG = (
    'const X_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="#ffffff" aria-hidden="true">'
    '<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>'
    '</svg>`;'
)

if "const X_SVG" not in s:
    # insert after GOOGLE_SVG line
    if "const GOOGLE_SVG" in s:
        # find end of GOOGLE_SVG line
        idx = s.find("const GOOGLE_SVG")
        end = s.find("\n", idx)
        s = s[: end + 1] + X_SVG + "\n" + s[end + 1 :]
        print("X_SVG const ok")
    else:
        raise SystemExit("GOOGLE_SVG not found")
else:
    print("X_SVG already")

# Prefer inline SVG for x over png img
old = '''        const icon = PROVIDER_ICON[p.id]
          ? `<img src="${PROVIDER_ICON[p.id]}" alt="" width="18" height="18" />`
          : (p.id === "google" ? GOOGLE_SVG : "");'''
new = '''        let icon = "";
        if (p.id === "google") icon = GOOGLE_SVG;
        else if (p.id === "x") icon = (typeof X_SVG !== "undefined" ? X_SVG : `<img src="login-icons/x.svg" alt="" width="18" height="18" />`);
        else if (PROVIDER_ICON[p.id]) icon = `<img src="${PROVIDER_ICON[p.id]}" alt="" width="18" height="18" />`;'''
if old in s:
    s = s.replace(old, new, 1)
    print("buildGateButtons ok")
elif "p.id === \"x\"" in s or "p.id === 'x'" in s:
    print("buildGateButtons already")
else:
    print("buildGateButtons pattern miss")

# Point PROVIDER_ICON x to svg for native extract fallback
if 'x: "login-icons/x.png"' in s:
    s = s.replace('x: "login-icons/x.png"', 'x: "login-icons/x.svg"', 1)
    print("PROVIDER_ICON path ok")
elif 'x: "login-icons/x.svg"' in s:
    print("PROVIDER_ICON already svg")

shim.write_text(s, encoding="utf-8")
print("DONE")
