#!/usr/bin/env python3
from pathlib import Path
import re

JS = Path("public/web-shim.js")

# Remove any post-OTP mapsky:// navigation; in-app WebView already has the cookie.
PAT = re.compile(
    r"\s*// Only deep-link into the native shell\.[\s\S]*?"
    r"if \(data\.xchg && inNative\) \{[\s\S]*?\}\s*"
    r"|\s*if \(data\.xchg\) \{\s*try \{\s*"
    r"window\.location\.href = \"mapsky://login-complete\?xchg=\" \+ encodeURIComponent\(data\.xchg\);\s*"
    r"\} catch \(z\) \{\}\s*\}\s*",
    re.M,
)


def main():
    js = JS.read_text(encoding="utf-8")
    if "mapsky://login-complete" not in js.split("Soft login")[1].split("hideMagicLinkVerifyPanel")[0] if "Soft login" in js else True:
        # Check specifically in soft-login block
        pass
    m_soft = js.find("Soft login: full reload")
    if m_soft < 0:
        raise SystemExit("soft login block missing")
    # Find xchg navigation inside soft login success
    chunk_start = m_soft
    chunk_end = js.find("hideMagicLinkVerifyPanel", chunk_start)
    chunk = js[chunk_start:chunk_end]
    if "mapsky://login-complete" not in chunk:
        print("no mapsky deeplink in soft-login block already")
        return
    # Strip from // Only deep-link OR if (data.xchg) through the closing brace before hideMagic
    new_chunk = re.sub(
        r"(?:\s*// Only deep-link[\s\S]*?if \(data\.xchg && inNative\) \{[\s\S]*?\}\s*|"
        r"\s*if \(data\.xchg\) \{[\s\S]*?catch \(z\) \{\}\s*\}\s*)",
        "\n            ",
        chunk,
        count=1,
    )
    js = js[:chunk_start] + new_chunk + js[chunk_end:]
    # Safety: soft-login block must not navigate to mapsky
    check = js[js.find("Soft login") : js.find("hideMagicLinkVerifyPanel", js.find("Soft login"))]
    if "mapsky://" in check:
        raise SystemExit("still has mapsky in soft-login block")
    JS.write_text(js, encoding="utf-8")
    print("patched: removed in-app OTP mapsky deeplink")


if __name__ == "__main__":
    main()
