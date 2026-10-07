#!/usr/bin/env python3
from pathlib import Path

JS = Path("public/web-shim.js")

OLD = '''            if (data.xchg) {
              try {
                window.location.href = "mapsky://login-complete?xchg=" + encodeURIComponent(data.xchg);
              } catch (z) {}
            }'''

NEW = '''            // Only deep-link into the native shell. In mobile Chrome/Safari a
            // mapsky:// navigation leaves the page and can show a false
            // "無法連線" screen. Cookie session already works in-page.
            var inNative = Boolean(
              (window.appInfo && window.appInfo.isNativeApp) ||
              (window.MapSkyNative && window.MapSkyNative.isNative) ||
              (window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform())
            );
            if (data.xchg && inNative) {
              try {
                window.location.href = "mapsky://login-complete?xchg=" + encodeURIComponent(data.xchg);
              } catch (z) {}
            }'''


def main():
    js = JS.read_text(encoding="utf-8")
    if "Only deep-link into the native shell" in js:
        print("already patched")
        return
    if OLD not in js:
        raise SystemExit("xchg block not found")
    JS.write_text(js.replace(OLD, NEW, 1), encoding="utf-8")
    print("patched")


if __name__ == "__main__":
    main()
