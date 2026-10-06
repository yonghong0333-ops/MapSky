#!/usr/bin/env python3
from pathlib import Path

# --- login.js: no otp in email call; return otp to client ---
login = Path("api/auth/login.js").read_text(encoding="utf-8")
if "otp: otpCode" not in login:
    if "await sendMagicLinkEmail(email, verifyUrl, otpCode);" in login:
        login = login.replace(
            "await sendMagicLinkEmail(email, verifyUrl, otpCode);",
            "await sendMagicLinkEmail(email, verifyUrl);",
        )
    # first ok:true return in handleSendMagicLink
    old_ret = "  return res.status(200).json({ ok: true });\n}"
    new_ret = "  return res.status(200).json({ ok: true, otp: otpCode });\n}"
    if old_ret not in login:
        raise SystemExit("login return not found")
    login = login.replace(old_ret, new_ret, 1)
    Path("api/auth/login.js").write_text(login, encoding="utf-8")
    print("login ok")
else:
    print("login already")

# --- callback cross-device ---
cb = Path("api/auth/callback.js").read_text(encoding="utf-8")
if "isCrossDevice" not in cb:
    old = "  const usedKey = `magiclink:used:${token}`;\n\n  if (req.method === \"POST\") {"
    new = (
        "  const usedKey = `magiclink:used:${token}`;\n"
        "  const cookieDevice = String(parseCookies(req).mapsky_ml_device || \"\");\n"
        "  const boundDeviceId = payload.deviceId ? String(payload.deviceId) : \"\";\n"
        "  const isCrossDevice = Boolean(boundDeviceId && cookieDevice && cookieDevice !== boundDeviceId);\n\n"
        "  if (req.method === \"POST\") {\n"
        "    if (isCrossDevice) {\n"
        "      return sendLoginError(res, \"magic-link-device-mismatch\");\n"
        "    }"
    )
    if old not in cb:
        raise SystemExit("callback post not found")
    cb = cb.replace(old, new)
    marker = "  const verifyAction = `/api/auth/callback?provider=email&token=${encodeURIComponent(String(token))}`;"
    insert = Path("scripts/otp/cross_device_otp_page.txt").read_text(encoding="utf-8")
    if marker not in cb:
        raise SystemExit("marker missing")
    cb = cb.replace(marker, insert + marker)
    Path("api/auth/callback.js").write_text(cb, encoding="utf-8")
    print("callback ok")
else:
    print("callback already")

# --- shim ---
js = Path("public/web-shim.js").read_text(encoding="utf-8")
old_show = (
    "    if (otpInput && showOtp) {\n"
    "      otpInput.value = \"\";\n"
    "      setTimeout(() => otpInput.focus(), 50);\n"
    "    }"
)
new_show = (
    "    const otpDisplay = el(\"loginGateVerifyOtpDisplay\");\n"
    "    if (otpDisplay) {\n"
    "      if (showOtp && opts && opts.otp) {\n"
    "        otpDisplay.textContent = String(opts.otp);\n"
    "        otpDisplay.classList.remove(\"hidden\");\n"
    "      } else {\n"
    "        otpDisplay.textContent = \"\";\n"
    "        otpDisplay.classList.add(\"hidden\");\n"
    "      }\n"
    "    }\n"
    "    if (otpInput && showOtp) {\n"
    "      otpInput.value = \"\";\n"
    "      setTimeout(() => otpInput.focus(), 50);\n"
    "    }"
)
if old_show in js:
    js = js.replace(old_show, new_show)
    print("shim display")
old_ok = (
    "      if (resp.ok && data.ok) {\n"
    "        showMagicLinkVerifyPanel(email);\n"
    "        return true;\n"
    "      } else if (resp.status === 429) {\n"
    "        showMagicLinkVerifyPanel(email);\n"
    "        return true;"
)
new_ok = (
    "      if (resp.ok && data.ok) {\n"
    "        showMagicLinkVerifyPanel(email, { otp: data.otp });\n"
    "        return true;\n"
    "      } else if (resp.status === 429) {\n"
    "        showMagicLinkVerifyPanel(email);\n"
    "        return true;"
)
if old_ok in js:
    js = js.replace(old_ok, new_ok)
    print("shim pass otp")
Path("public/web-shim.js").write_text(js, encoding="utf-8")

# --- html ---
html = Path("public/index.html").read_text(encoding="utf-8")
if "loginGateVerifyOtpDisplay" not in html:
    old_b = (
        "        <div id=\"loginGateVerifyOtpBlock\" class=\"login-gate-verify-otp hidden\">\n"
        "          <p class=\"login-gate-verify-hint\">請輸入信件中的 <strong>6 位數驗證碼</strong></p>"
    )
    new_b = (
        "        <div id=\"loginGateVerifyOtpBlock\" class=\"login-gate-verify-otp hidden\">\n"
        "          <p class=\"login-gate-verify-hint\">請輸入下方驗證碼完成登入</p>\n"
        "          <div id=\"loginGateVerifyOtpDisplay\" class=\"login-gate-verify-otp-display hidden\" aria-live=\"polite\"></div>"
    )
    if old_b not in html:
        raise SystemExit("html block missing")
    html = html.replace(old_b, new_b)
    Path("public/index.html").write_text(html, encoding="utf-8")
    print("html ok")
else:
    print("html already")

# --- css ---
css = Path("public/style.css").read_text(encoding="utf-8")
if "login-gate-verify-otp-display" not in css:
    css += (
        "\n.login-gate-verify-otp-display {\n"
        "  width: 100%; margin: 8px 0 12px; padding: 12px 16px; border-radius: 12px;\n"
        "  border: 1px solid var(--input-border); background: var(--input-bg);\n"
        "  color: var(--accent); font-size: 26px; font-weight: 800;\n"
        "  letter-spacing: 0.35em; text-align: center; box-sizing: border-box;\n"
        "}\n"
        ".login-gate-verify-otp-display.hidden { display: none; }\n"
    )
    Path("public/style.css").write_text(css, encoding="utf-8")
    print("css ok")
print("DONE")
