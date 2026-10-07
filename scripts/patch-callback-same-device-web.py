#!/usr/bin/env python3
from pathlib import Path
import re

CB = Path("api/auth/callback.js")

# After setting session cookie on same-device POST, always go to web app.
# mapsky:// unloads App WebView and shows native offline screen.
NEW_BLOCK = '''
    const webUrl = "/?login=success";
    // Same-device: session cookie is already on this WebView/browser.
    // Never 302 to mapsky:// here — inside MapSky App that unloads the page
    // and triggers the native "目前無法連線" screen.
    res.writeHead(302, { Location: webUrl });
    return res.end();
  }
'''


def main():
    c = CB.read_text(encoding="utf-8")
    if "Never 302 to mapsky:// here" in c:
        print("already patched")
        return

    # Match from const webUrl through the mobile/appHtml branch start of POST success
    # Pattern: const webUrl = ... then various ifs until "const appHtml" OR closing of POST
    pat = re.compile(
        r"const webUrl = \"/\?login=success\";\s*"
        r"if \(!xchg\) \{[\s\S]*?return res\.end\(\);\s*\}\s*"
        r"const appUrl = `mapsky://login-complete\?xchg=\$\{encodeURIComponent\(xchg\)\}`;\s*"
        r"const ua = String\(req\.headers\[\"user-agent\"\] \|\| \"\"\);\s*"
        r"const looksMobile = /iPhone\|iPad\|iPod\|Android/i\.test\(ua\);\s*"
        r"(?:[\s\S]*?)"
        r"if \(looksMobile\) \{\s*"
        r"res\.writeHead\(302, \{ Location: appUrl \}\);\s*"
        r"return res\.end\(\);\s*"
        r"\}\s*"
        r"(?=const appHtml)",
        re.M,
    )
    m = pat.search(c)
    if not m:
        # try simpler: from webUrl to appHtml
        pat2 = re.compile(
            r"const webUrl = \"/\?login=success\";[\s\S]*?(?=const appHtml = )",
            re.M,
        )
        m2 = pat2.search(c)
        if not m2:
            raise SystemExit("webUrl/appHtml block not found")
        # Only replace the first occurrence inside handleEmailVerify POST
        # Find handleEmailVerify then search
        he = c.find("async function handleEmailVerify")
        m2 = pat2.search(c, he)
        if not m2:
            raise SystemExit("webUrl block not found in handleEmailVerify")
        c = c[: m2.start()] + NEW_BLOCK.lstrip("\n") + c[m2.end() :]
    else:
        c = c[: m.start()] + NEW_BLOCK.lstrip("\n") + c[m.end() :]

    CB.write_text(c, encoding="utf-8")
    print("patched", CB.stat().st_size)
    assert "Never 302 to mapsky:// here" in CB.read_text(encoding="utf-8")


if __name__ == "__main__":
    main()
