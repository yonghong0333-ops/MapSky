#!/usr/bin/env python3
from pathlib import Path
p = Path("public/index.html")
s = p.read_text(encoding="utf-8")
old = 'placeholder="輸入 Email 取得登入連結"'
new = 'placeholder="請輸入電子郵件"'
if old not in s:
    if new in s:
        print("already updated")
    else:
        raise SystemExit("placeholder not found")
else:
    s = s.replace(old, new)
    p.write_text(s, encoding="utf-8")
    print("updated")
