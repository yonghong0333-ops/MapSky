#!/usr/bin/env python3
from pathlib import Path

src = Path("api/auth/callback.js").read_text(encoding="utf-8")
if "請回到 MapSky 完成驗證" in src and "otpForm" not in src:
    print("callback already fixed")
else:
    start = src.find("  if (!isSameDevice) {\n    const emailSafe")
    if start < 0:
        # fallback: find otpHtml block
        j = src.find("const otpHtml")
        if j < 0:
            raise SystemExit("otp block not found")
        start = src.rfind("  if (!isSameDevice)", 0, j)
    end = src.find("  const verifyAction =", start)
    if start < 0 or end < 0:
        raise SystemExit(f"markers missing {start} {end}")
    new_block = (
        "  if (!isSameDevice) {\n"
        "    // OTP is entered inside MapSky app only, not in the browser.\n"
        "    const emailSafe = String(payload.email).replace(/[<>&\"']/g, \"\");\n"
        "    const appHint = `mapsky://login-otp?email=${encodeURIComponent(payload.email)}`;\n"
        "    const webHint = `/?need_otp=1&email=${encodeURIComponent(payload.email)}`;\n"
        "    const html = `<!doctype html>\n"
        "<html lang=\"zh-Hant\"><head><meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n"
        "<title>請回到 MapSky</title></head>\n"
        "<body style=\"font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif;max-width:420px;margin:60px auto;padding:0 24px;text-align:center;color:#1f2937\">\n"
        "<h2 style=\"margin-bottom:8px;\">請回到 MapSky 完成驗證</h2>\n"
        "<p style=\"color:#6b7280;line-height:1.7;\">這不是當初申請登入的裝置，無法直接用連結登入。<br>\n"
        "請打開 <strong>MapSky</strong>，在登入畫面輸入寄到 <strong>${emailSafe}</strong> 的 <strong>6 位數驗證碼</strong>。</p>\n"
        "<p style=\"margin-top:24px;\">\n"
        "  <a href=\"${appHint}\" style=\"display:inline-block;padding:14px 28px;background:#1d4ed8;color:#fff;border-radius:999px;text-decoration:none;font-weight:700;\">打開 MapSky</a>\n"
        "</p>\n"
        "<p style=\"margin-top:16px;font-size:13px;\"><a href=\"${webHint}\" style=\"color:#1d4ed8;\">或在網頁版繼續輸入驗證碼</a></p>\n"
        "<script>\n"
        "  setTimeout(function () { window.location.href = ${JSON.stringify(appHint)}; }, 400);\n"
        "</script>\n"
        "</body></html>`;\n"
        "    res.status(200).setHeader(\"Content-Type\", \"text/html; charset=utf-8\");\n"
        "    return res.send(html);\n"
        "  }\n\n"
    )
    src = src[:start] + new_block + src[end:]
    Path("api/auth/callback.js").write_text(src, encoding="utf-8")
    print("callback ok")

js = Path("public/web-shim.js").read_text(encoding="utf-8")
changed = False
if 'otpBlock.classList.toggle("hidden", mobile)' in js:
    js = js.replace(
        'if (otpBlock) otpBlock.classList.toggle("hidden", mobile);',
        'if (otpBlock) otpBlock.classList.remove("hidden");',
    )
    js = js.replace("if (otpInput && !mobile)", "if (otpInput)")
    changed = True
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
    changed = True
    print("need_otp hook")
if changed:
    Path("public/web-shim.js").write_text(js, encoding="utf-8")
print("DONE")
