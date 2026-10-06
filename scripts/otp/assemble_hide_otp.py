#!/usr/bin/env python3
from pathlib import Path
import base64

# --- login.js ---
login = Path("api/auth/login.js").read_text(encoding="utf-8")
if "otp: otpCode" not in login:
    if "await sendMagicLinkEmail(email, verifyUrl, otpCode);" in login:
        login = login.replace(
            "await sendMagicLinkEmail(email, verifyUrl, otpCode);",
            "await sendMagicLinkEmail(email, verifyUrl);",
        )
    old_ret = "  return res.status(200).json({ ok: true });\n}"
    new_ret = "  return res.status(200).json({ ok: true, otp: otpCode });\n}"
    if old_ret not in login:
        raise SystemExit("login return not found")
    login = login.replace(old_ret, new_ret, 1)
    Path("api/auth/login.js").write_text(login, encoding="utf-8")
    print("login ok")
else:
    print("login already")

# --- callback ---
cb = Path("api/auth/callback.js").read_text(encoding="utf-8")
if "isCrossDevice" not in cb:
    old = "  const usedKey = `magiclink:used:${token}`;\n\n  if (req.method === \"POST\") {"
    new = (
        "  const usedKey = `magiclink:used:${token}`;\n"
        "  const cookieDevice = String(parseCookies(req).mapsky_ml_device || \"\");\n"
        "  const boundDeviceId = payload.deviceId ? String(payload.deviceId) : \"\";\n"
        "  // no cookie = mail app browser (same phone) -> allow direct login\n"
        "  // cookie match = same device -> direct login\n"
        "  // cookie mismatch = other device -> show OTP\n"
        "  const isCrossDevice = Boolean(boundDeviceId && cookieDevice && cookieDevice !== boundDeviceId);\n\n"
        "  if (req.method === \"POST\") {\n"
        "    if (isCrossDevice) {\n"
        "      return sendLoginError(res, \"magic-link-device-mismatch\");\n"
        "    }"
    )
    if old not in cb:
        raise SystemExit("callback post not found")
    cb = cb.replace(old, new)

    # Prefer file if valid, else built-in insert
    insert_path = Path("scripts/otp/cross_device_otp_page.txt")
    b64_path = Path("scripts/otp/cross_device_otp_page.b64")
    if insert_path.exists() and "otpForm" in insert_path.read_text(encoding="utf-8", errors="ignore"):
        insert = insert_path.read_text(encoding="utf-8")
    elif b64_path.exists():
        insert = base64.b64decode(b64_path.read_text().strip()).decode("utf-8")
    else:
        insert = ""

    if "otpForm" not in insert:
        # fallback minimal insert generated here
        insert = (
            "  if (isCrossDevice) {\n"
            "    const emailSafe = String(payload.email).replace(/[<>&\"']/g, \"\");\n"
            "    const html = `<!doctype html><html lang=\"zh-Hant\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<title>輸入驗證碼</title></head><body style=\"font-family:sans-serif;max-width:420px;margin:60px auto;padding:0 24px;text-align:center\">"
            "<h2>請輸入驗證碼</h2>"
            "<p style=\"color:#6b7280\">偵測到這是其他裝置。請輸入在 MapSky 畫面上顯示的 6 位數驗證碼。</p>"
            "<form id=\"otpForm\"><input id=\"otpInput\" maxlength=\"6\" inputmode=\"numeric\" "
            "style=\"width:100%;padding:14px;font-size:24px;letter-spacing:0.3em;text-align:center\"/>"
            "<button type=\"submit\" id=\"otpBtn\" style=\"margin-top:12px;width:100%;padding:14px;background:#1d4ed8;color:#fff;border:0;border-radius:999px\">驗證並登入</button></form>"
            "<p id=\"otpErr\" style=\"color:#b3261e\"></p>"
            "<script>(function(){var f=document.getElementById('otpForm'),i=document.getElementById('otpInput'),"
            "b=document.getElementById('otpBtn'),e=document.getElementById('otpErr');"
            "var email=${JSON.stringify(payload.email)};"
            "i.oninput=function(){i.value=i.value.replace(/\\D/g,'').slice(0,6)};"
            "f.onsubmit=async function(ev){ev.preventDefault();var c=(i.value||'').replace(/\\D/g,'').slice(0,6);"
            "if(c.length!==6){e.textContent='請輸入6位驗證碼';return;}b.disabled=true;e.textContent='';"
            "try{var r=await fetch('/api/auth/login?provider=email&action=verify-code',{method:'POST',"
            "headers:{'Content-Type':'application/json'},credentials:'same-origin',"
            "body:JSON.stringify({email:email,code:c})});var d=await r.json().catch(function(){return{}});"
            "if(r.ok&&d.ok){location.href='/?login=success';return;}"
            "e.textContent=d.reason==='wrong-code'?'驗證碼不正確或已過期':'驗證失敗';}"
            "catch(x){e.textContent='網路錯誤';}finally{b.disabled=false;}};"
            "setTimeout(function(){i.focus()},100);})();</script></body></html>`;\n"
            "    res.status(200).setHeader(\"Content-Type\", \"text/html; charset=utf-8\");\n"
            "    return res.send(html);\n"
            "  }\n\n"
        )

    marker = "  const verifyAction = `/api/auth/callback?provider=email&token=${encodeURIComponent(String(token))}`;"
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
