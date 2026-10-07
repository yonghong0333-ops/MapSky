#!/usr/bin/env python3
from pathlib import Path

CB = Path("api/auth/callback.js")

OLD = '''    if (looksMobile) {
      res.writeHead(302, { Location: appUrl });
      return res.end();
    }'''

NEW = '''    const inNativeApp = /MapSkyiOS/i.test(ua) || /MapSkyApp/i.test(ua);
    // Already in App WebView: cookie set — do not 302 to mapsky:// (causes offline screen)
    if (inNativeApp) {
      res.writeHead(302, { Location: webUrl });
      return res.end();
    }
    // System mobile browser: open App via custom scheme
    if (looksMobile) {
      res.writeHead(302, { Location: appUrl });
      return res.end();
    }'''


def main():
    c = CB.read_text(encoding="utf-8")
    if "const inNativeApp = /MapSkyiOS" in c:
        print("already patched")
        return
    if OLD not in c:
        raise SystemExit("looksMobile redirect block not found")
    # Only replace the first occurrence after magic-link appUrl (email verify path)
    idx = c.find("const appUrl = `mapsky://login-complete")
    if idx < 0:
        raise SystemExit("appUrl not found")
    pos = c.find(OLD, idx)
    if pos < 0:
        raise SystemExit("block not found after appUrl")
    c = c[:pos] + NEW + c[pos + len(OLD) :]
    CB.write_text(c, encoding="utf-8")
    print("patched", CB.stat().st_size)


if __name__ == "__main__":
    main()
