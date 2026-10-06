#!/usr/bin/env python3
import base64
from pathlib import Path
parts = []
i = 0
while Path(f"scripts/otp/inapp_all_{i}.b64").exists():
    parts.append(Path(f"scripts/otp/inapp_all_{i}.b64").read_text().strip())
    i += 1
if not parts and Path("scripts/otp/inapp_cb_all.b64").exists():
    parts = [Path("scripts/otp/inapp_cb_all.b64").read_text().strip()]
Path("api/auth/callback.js").write_bytes(base64.b64decode("".join(parts)))
print("callback written", Path("api/auth/callback.js").stat().st_size)

js = Path("public/web-shim.js").read_text(encoding="utf-8")
if 'otpBlock.classList.toggle("hidden", mobile)' in js:
    js = js.replace(
        'if (otpBlock) otpBlock.classList.toggle("hidden", mobile);',
        'if (otpBlock) otpBlock.classList.remove("hidden");',
    )
    js = js.replace("if (otpInput && !mobile)", "if (otpInput)")
    print("otp always in app")
if "maybeOpenOtpFromQuery" not in js:
    hook = (
        "\n  function maybeOpenOtpFromQuery() {\n"
        "    try {\n"
        "      const params = new URLSearchParams(window.location.search);\n"
        "      if (params.get(\"need_otp\") !== \"1\") return;\n"
        "      const email = (params.get(\"email\") || \"\").trim();\n"
        "      if (!email) return;\n"
        "      try {\n"
        "        const u = new URL(window.location.href);\n"
        "        u.searchParams.delete(\"need_otp\");\n"
        "        u.searchParams.delete(\"email\");\n"
        "        window.history.replaceState({}, \"\", u.pathname + u.search + u.hash);\n"
        "      } catch (e) {}\n"
        "      showMagicLinkVerifyPanel(email);\n"
        "    } catch (e) {}\n"
        "  }\n\n"
    )
    js = js.replace("  function initMagicLinkForm() {", hook + "  function initMagicLinkForm() {")
    js = js.replace("    initMagicLinkForm();", "    initMagicLinkForm();\n    maybeOpenOtpFromQuery();", 1)
    print("need_otp hook")
Path("public/web-shim.js").write_text(js, encoding="utf-8")
print("DONE")
