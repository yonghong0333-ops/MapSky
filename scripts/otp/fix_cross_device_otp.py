#!/usr/bin/env python3
from pathlib import Path

# --- mailer: put OTP back in email ---
mailer = Path("api/_lib/mailer.js").read_text(encoding="utf-8")
new_mailer = '''// 寄送 Email 用的共用 helper —— Magic Link 登入信會用到。
const nodemailer = require("nodemailer");

let cachedTransporter = null;
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_PASS;
  if (!user || !pass) {
    throw new Error("缺少環境變數 GMAIL_USER / GMAIL_PASS（Gmail 帳號與應用程式密碼），無法寄信");
  }
  cachedTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
  return cachedTransporter;
}

/**
 * @param {string} toEmail
 * @param {string} verifyUrl
 * @param {string} [otpCode] 6 位驗證碼（跨裝置時使用）
 */
async function sendMagicLinkEmail(toEmail, verifyUrl, otpCode) {
  const transporter = getTransporter();
  const codeHtml = otpCode
    ? `<div style="text-align:center;margin:24px 0 8px;">
         <div style="font-size:12px;color:#6b7684;margin-bottom:8px;">若在其他裝置開啟，請輸入這組驗證碼</div>
         <div style="display:inline-block;letter-spacing:0.35em;font-size:28px;font-weight:800;color:#2f6fed;background:#fff;border:1px solid #d6e0f5;border-radius:12px;padding:12px 20px 12px 28px;">${otpCode}</div>
       </div>`
    : "";

  const html = `
  <div style="font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f4f7fc;border-radius:16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:22px;font-weight:800;color:#2f6fed;">MapSky</div>
    </div>
    <p style="font-size:15px;color:#222b38;line-height:1.7;">您好，這是您在 MapSky 登入用的驗證資訊，15 分鐘內有效：</p>
    <div style="text-align:center;margin:28px 0 8px;">
      <a href="${verifyUrl}" style="display:inline-block;padding:14px 32px;background:#2f6fed;color:#fff;text-decoration:none;border-radius:999px;font-size:15px;font-weight:700;">登入 MapSky</a>
    </div>
    <p style="font-size:12.5px;color:#6b7684;line-height:1.6;text-align:center;">用<strong>同一支手機</strong>點上面按鈕，可直接登入。<br>在<strong>其他裝置</strong>開啟時，請輸入下方驗證碼。</p>
    ${codeHtml}
    <p style="font-size:12.5px;color:#6b7684;line-height:1.6;margin-top:20px;">如果按鈕點不了，也可以複製下面這段網址到瀏覽器開啟：<br>
      <span style="word-break:break-all;color:#2f6fed;">${verifyUrl}</span>
    </p>
    <p style="font-size:12px;color:#93a0af;margin-top:24px;">如果不是您本人操作，忽略這封信即可，連結與驗證碼 15 分鐘後會自動失效。</p>
  </div>`;

  await transporter.sendMail({
    from: `"MapSky" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: otpCode ? `登入 MapSky：驗證碼 ${otpCode}` : "登入 MapSky",
    html,
  });
}

module.exports = { sendMagicLinkEmail };
'''
Path("api/_lib/mailer.js").write_text(new_mailer, encoding="utf-8")
print("mailer ok")

# --- login.js: pass otp to mailer again ---
login = Path("api/auth/login.js").read_text(encoding="utf-8")
if "sendMagicLinkEmail(email, verifyUrl, otpCode)" in login:
    print("login mailer call already")
elif "sendMagicLinkEmail(email, verifyUrl);" in login:
    login = login.replace(
        "await sendMagicLinkEmail(email, verifyUrl);",
        "await sendMagicLinkEmail(email, verifyUrl, otpCode);",
    )
    Path("api/auth/login.js").write_text(login, encoding="utf-8")
    print("login ok")
else:
    print("WARN login call")

# --- callback: treat missing cookie as cross-device when deviceId bound ---
cb = Path("api/auth/callback.js").read_text(encoding="utf-8")
old_cross = (
    '  const isCrossDevice = Boolean(boundDeviceId && cookieDevice && cookieDevice !== boundDeviceId);'
)
# same device ONLY when cookie matches; no cookie or mismatch → OTP page
new_cross = (
    '  // 只有 cookie 完全吻合才算同裝置直接登入；\n'
    '  // 沒有 cookie（其他裝置的信箱／瀏覽器）或 cookie 不同 → 顯示驗證碼\n'
    '  const isSameDevice = Boolean(boundDeviceId && cookieDevice && cookieDevice === boundDeviceId);\n'
    '  const isCrossDevice = Boolean(boundDeviceId && !isSameDevice);'
)
if "isSameDevice = Boolean" in cb:
    print("callback already")
elif old_cross in cb:
    cb = cb.replace(old_cross, new_cross, 1)
    # Improve OTP page copy to mention email code
    cb = cb.replace(
        "請輸入在 MapSky 畫面上顯示的 6 位數驗證碼。",
        "請輸入信件中的 6 位數驗證碼（或在申請登入的裝置上查看）。",
    )
    Path("api/auth/callback.js").write_text(cb, encoding="utf-8")
    print("callback ok")
else:
    print("WARN callback pattern")

# --- shim: always show OTP after send (so device A also has it) ---
js = Path("public/web-shim.js").read_text(encoding="utf-8")
old_show = (
    "    const mobile = isMobileLoginDevice();\n"
    "    const forceOtp = !!(opts && opts.forceOtp);\n"
    "    const showOtp = forceOtp || !mobile;\n"
)
new_show = (
    "    const mobile = isMobileLoginDevice();\n"
    "    const forceOtp = !!(opts && opts.forceOtp);\n"
    "    // 一律顯示驗證碼：方便跨裝置時在 A 裝置看到／對照信件\n"
    "    const showOtp = true;\n"
)
if "const showOtp = true;" in js:
    print("shim already")
elif old_show in js:
    js = js.replace(old_show, new_show, 1)
    Path("public/web-shim.js").write_text(js, encoding="utf-8")
    print("shim ok")
else:
    print("WARN shim")

print("DONE")
