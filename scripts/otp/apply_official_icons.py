#!/usr/bin/env python3
from pathlib import Path
import struct, zlib, math

def write_x_png(path: Path, size=64):
    # thick X logo similar to official mark
    w = h = size
    rows = []
    thickness = size * 0.14
    for y in range(h):
        row = [0]
        for x in range(w):
            # distance to two diagonals
            # line1: y = x, line2: y = size-1-x
            d1 = abs(x - y) / math.sqrt(2)
            d2 = abs(x - (size - 1 - y)) / math.sqrt(2)
            margin = size * 0.12
            inside = (margin <= x <= size - 1 - margin) and (margin <= y <= size - 1 - margin)
            on = inside and (d1 <= thickness / 2 or d2 <= thickness / 2)
            if on:
                row.extend([15, 15, 15, 255])
            else:
                row.extend([0, 0, 0, 0])
        rows.append(bytes(row))
    raw = b"".join(rows)
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)

Path("public/login-icons").mkdir(parents=True, exist_ok=True)
write_x_png(Path("public/login-icons/x.png"))
print("x.png", Path("public/login-icons/x.png").stat().st_size)

shim = Path("public/web-shim.js")
s = shim.read_text(encoding="utf-8")

# Prefer img (so native Liquid Glass can download official PNG)
old = '''        let icon = "";
        if (p.id === "google") icon = GOOGLE_SVG;
        else if (p.id === "x") icon = (typeof X_SVG !== "undefined" ? X_SVG : `<img src="login-icons/x.svg" alt="" width="18" height="18" />`);
        else if (PROVIDER_ICON[p.id]) icon = `<img src="${PROVIDER_ICON[p.id]}" alt="" width="18" height="18" />`;'''
new = '''        let icon = "";
        // 一律用 <img> 官方圖檔，原生 Liquid Glass 才能用 URL 下載（inline SVG 無法當 UIImage）
        if (PROVIDER_ICON[p.id]) {
          icon = `<img src="${PROVIDER_ICON[p.id]}" alt="" width="18" height="18" />`;
        } else if (p.id === "google") {
          icon = GOOGLE_SVG;
        } else if (p.id === "x" && typeof X_SVG !== "undefined") {
          icon = X_SVG;
        }'''
if old in s:
    s = s.replace(old, new, 1)
    print("buildGateButtons ok")
elif "一律用 <img> 官方圖檔" in s:
    print("already")
else:
    # fallback: older pattern with ternary
    old2 = '''        const icon = PROVIDER_ICON[p.id]
          ? `<img src="${PROVIDER_ICON[p.id]}" alt="" width="18" height="18" />`
          : (p.id === "google" ? GOOGLE_SVG : "");'''
    if old2 in s:
        s = s.replace(old2, new, 1)
        print("buildGateButtons old2 ok")
    else:
        print("pattern miss")

# ensure x points to png not svg for native UIImage
if 'x: "login-icons/x.svg"' in s:
    s = s.replace('x: "login-icons/x.svg"', 'x: "login-icons/x.png"', 1)
    print("x png path")
elif 'x: "login-icons/x.png"' not in s:
    s = s.replace(
        'google: "login-icons/google.png",',
        'google: "login-icons/google.png",\n    x: "login-icons/x.png",',
        1,
    )
    print("x icon added")

shim.write_text(s, encoding="utf-8")
print("DONE")
