#!/usr/bin/env python3
from pathlib import Path

js = Path("public/web-shim.js").read_text(encoding="utf-8")

old_fn = "  function showMagicLinkVerifyPanel(email) {"
new_fn = "  function showMagicLinkVerifyPanel(email, opts) {"
if old_fn in js:
    js = js.replace(old_fn, new_fn, 1)
    print("fn ok")

old = (
    "    const mobile = isMobileLoginDevice();\n"
    "    if (mobileHint) mobileHint.classList.toggle(\"hidden\", !mobile);\n"
    "    if (otpBlock) otpBlock.classList.remove(\"hidden\");\n"
    "    if (otpError) { otpError.classList.add(\"hidden\"); otpError.textContent = \"\"; }\n"
    "    if (otpInput) {\n"
    "      otpInput.value = \"\";\n"
    "      setTimeout(() => otpInput.focus(), 50);\n"
    "    }"
)
new = (
    "    // After send: mobile -> link hint only; non-mobile -> show OTP\n"
    "    const mobile = isMobileLoginDevice();\n"
    "    const forceOtp = !!(opts && opts.forceOtp);\n"
    "    const showOtp = forceOtp || !mobile;\n"
    "    if (mobileHint) mobileHint.classList.toggle(\"hidden\", !mobile || forceOtp);\n"
    "    if (otpBlock) otpBlock.classList.toggle(\"hidden\", !showOtp);\n"
    "    if (otpError) { otpError.classList.add(\"hidden\"); otpError.textContent = \"\"; }\n"
    "    if (otpInput && showOtp) {\n"
    "      otpInput.value = \"\";\n"
    "      setTimeout(() => otpInput.focus(), 50);\n"
    "    }"
)
if old not in js:
    raise SystemExit("block not found")
js = js.replace(old, new)
print("body ok")

old_call = (
    "      showMagicLinkVerifyPanel(email);\n"
    "    } catch (e) {}\n"
    "  }\n\n"
    "  function initMagicLinkForm()"
)
new_call = (
    "      showMagicLinkVerifyPanel(email, { forceOtp: true });\n"
    "    } catch (e) {}\n"
    "  }\n\n"
    "  function initMagicLinkForm()"
)
if old_call in js:
    js = js.replace(old_call, new_call)
    print("need_otp force")

Path("public/web-shim.js").write_text(js, encoding="utf-8")
print("DONE")
