#!/usr/bin/env python3
from pathlib import Path
import re

CB = Path("api/auth/callback.js")

NEW = '''    const webUrl = "/?login=success";
    // Same-device: session cookie is already on this WebView/browser.
    // Never 302 to mapsky:// — inside MapSky App that unloads the page
    // and triggers the native "目前無法連線" screen.
    res.writeHead(302, { Location: webUrl });
    return res.end();
'''


def main():
    c = CB.read_text(encoding="utf-8")
    if "Never 302 to mapsky:// — inside MapSky App" in c:
        print("already patched")
        return

    he = c.find("async function handleEmailVerify")
    if he < 0:
        raise SystemExit("handleEmailVerify not found")

    # From first webUrl in handleEmailVerify through end of appHtml send
    pat = re.compile(
        r"const webUrl = \"/\?login=success\";[\s\S]*?"
        r"return res\.status\(200\)\.send\(appHtml\);\s*",
        re.M,
    )
    m = pat.search(c, he)
    if not m:
        raise SystemExit("webUrl..appHtml block not found")

    c = c[: m.start()] + NEW + c[m.end() :]
    CB.write_text(c, encoding="utf-8")
    print("patched", CB.stat().st_size)


if __name__ == "__main__":
    main()
