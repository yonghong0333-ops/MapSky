#!/usr/bin/env python3
from pathlib import Path

# --- mailer: button only, no visible OTP ---
Path("api/_lib/mailer.js").write_text(
'''// 寄送 Email 用的共用 helper —— Magic Link 登入信會用到。
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
 * 信件只放登入按鈕（驗證碼不外露）。
 * 同裝置點按鈕可直接／經 App 完成；不同裝置點進去後，頁面判斷無法跳轉才顯示驗證碼。
 * @param {string} toEmail
 * @param {string} verifyUrl
 * @param {string} [_otpCode] 保留參數相容，不再寫進信件
 */
async function sendMagicLinkEmail(toEmail, verifyUrl, _otpCode) {
  const transporter = getTransporter();

  const html = `
  <div style="font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f4f7fc;border-radius:16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:22px;font-weight:800;color:#2f6fed;">MapSky</div>
    </div>
    <p style="font-size:15px;color:#222b38;line-height:1.7;">您好，這是您在 MapSky 的登入連結，15 分鐘內有效：</p>
    <div style="text-align:center;margin:28px 0 8px;">
      <a href="${verifyUrl}" style="display:inline-block;padding:14px 32px;background:#2f6fed;color:#fff;text-decoration:none;border-radius:999px;font-size:15px;font-weight:700;">登入 MapSky</a>
    </div>
    <p style="font-size:12.5px;color:#6b7684;line-height:1.6;text-align:center;">用<strong>同一支手機</strong>點上面按鈕，系統會嘗試直接完成登入。<br>若在其他裝置開啟，頁面會再顯示驗證碼。</p>
    <p style="font-size:12.5px;color:#6b7684;line-height:1.6;margin-top:20px;">如果按鈕點不了，也可以複製下面這段網址到瀏覽器開啟：<br>
      <span style="word-break:break-all;color:#2f6fed;">${verifyUrl}</span>
    </p>
    <p style="font-size:12px;color:#93a0af;margin-top:24px;">如果不是您本人操作，忽略這封信即可，連結 15 分鐘後會自動失效。</p>
  </div>`;

  await transporter.sendMail({
    from: `"MapSky" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: "登入 MapSky",
    html,
  });
}

module.exports = { sendMagicLinkEmail };
''',
    encoding="utf-8",
)
print("mailer ok")

# --- login.js: also store plaintext for post-judgment display ---
login_path = Path("api/auth/login.js")
login = login_path.read_text(encoding="utf-8")

old_set = (
    '  await client.set(`magiclink:otp:${email}`, hashOtp(email, otpCode), { EX: OTP_TTL_SECONDS });\n'
    '  await client.del(`magiclink:otp-tries:${email}`);'
)
new_set = (
    '  await client.set(`magiclink:otp:${email}`, hashOtp(email, otpCode), { EX: OTP_TTL_SECONDS });\n'
    '  // 明文僅供「點連結後判斷無法跳轉」時在頁面顯示，不進信件\n'
    '  await client.set(`magiclink:otp-plain:${email}`, otpCode, { EX: OTP_TTL_SECONDS });\n'
    '  await client.del(`magiclink:otp-tries:${email}`);'
)
if "magiclink:otp-plain" in login:
    print("login plain already")
elif old_set in login:
    login = login.replace(old_set, new_set, 1)
    print("login set ok")
else:
    raise SystemExit("login set pattern missing")

# delete plain on verify success
if "otp-plain" in login and "client.del(otpKey)" in login:
    if "magiclink:otp-plain:${email}" in login and "await client.del(`magiclink:otp-plain:${email}`)" in login:
        print("login del already")
    else:
        login = login.replace(
            "  await client.del(otpKey);\n  await client.del(triesKey);",
            "  await client.del(otpKey);\n  await client.del(`magiclink:otp-plain:${email}`);\n  await client.del(triesKey);",
            1,
        )
        print("login del ok")

# also del plain when send fails
if "await client.del(`magiclink:otp:${email}`)" in login:
    login = login.replace(
        "try { await client.del(`magiclink:otp:${email}`); } catch (_) {}",
        "try { await client.del(`magiclink:otp:${email}`); await client.del(`magiclink:otp-plain:${email}`); } catch (_) {}",
        1,
    )

login_path.write_text(login, encoding="utf-8")

# --- callback: load plain OTP and show only after probe fails ---
cb_path = Path("api/auth/callback.js")
cb = cb_path.read_text(encoding="utf-8")

# Update calls to async fetch plain otp
# Change isCrossDevice blocks to fetch plain first
if "otp-plain" not in cb:
    # helper before sendCrossDeviceOtpPage
    helper = '''
async function loadOtpPlain(email) {
  try {
    const client = await getRedisClient();
    if (!client || !email) return "";
    const v = await client.get(`magiclink:otp-plain:${String(email).trim().toLowerCase()}`);
    return v && /^\\d{6}$/.test(String(v)) ? String(v) : "";
  } catch (e) {
    return "";
  }
}

'''
    # insert before function sendCrossDeviceOtpPage
    idx = cb.find("function sendCrossDeviceOtpPage")
    if idx < 0:
        raise SystemExit("sendCrossDeviceOtpPage missing")
    cb = cb[:idx] + helper + cb[idx:]

    # change signature to include otpPlain
    cb = cb.replace(
        "function sendCrossDeviceOtpPage(res, email, token) {",
        "function sendCrossDeviceOtpPage(res, email, token, otpPlain) {",
        1,
    )

    # replace call sites with await load
    cb = cb.replace(
        "return sendCrossDeviceOtpPage(res, payload.email, token);",
        "return sendCrossDeviceOtpPage(res, payload.email, token, await loadOtpPlain(payload.email));",
    )
    print("callback load+calls ok")
else:
    print("callback plain maybe already")

# In the HTML of sendCrossDeviceOtpPage, show OTP digits only after enableOtp
# Find otp section and inject display
if "id=\"otpCodeReveal\"" not in cb:
    # replace the otp section intro paragraph area
    old_otp_intro = (
        '<div style="margin:8px 0 6px;color:#9ca3af;font-size:12px">— 其他裝置／未跳轉時 —</div>\n'
        '  <p style="color:#6b7280;line-height:1.6;font-size:13.5px">請輸入信件中的 6 位數驗證碼，在此瀏覽器登入。</p>'
    )
    new_otp_intro = (
        '<div style="margin:8px 0 6px;color:#9ca3af;font-size:12px">— 其他裝置／未跳轉時 —</div>\n'
        '  <p style="color:#6b7280;line-height:1.6;font-size:13.5px">請使用下方驗證碼，在此瀏覽器登入。</p>\n'
        '  <div id="otpCodeReveal" style="display:none;margin:14px 0;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">\n'
        '    <div style="font-size:12px;color:#6b7684;margin-bottom:6px">您的驗證碼</div>\n'
        '    <div style="font-size:28px;font-weight:800;letter-spacing:0.35em;color:#2f6fed">' + '${otpPlain && /^\\d{6}$/.test(String(otpPlain)) ? String(otpPlain) : "———"}' + '</div>\n'
        '  </div>'
    )
    # The template is in a JS template string - otpPlain needs to be interpolated server-side
    # Fix approach: use JS string concat in the server function

# Better rewrite the reveal in the function using server-side injection
start = cb.find("function sendCrossDeviceOtpPage(res, email, token, otpPlain)")
if start < 0:
    start = cb.find("function sendCrossDeviceOtpPage(res, email, token)")
end = cb.find("// 桌面版登入的備援驗證", start)
if start < 0 or end < 0:
    raise SystemExit("fn bounds")

new_fn = r'''function sendCrossDeviceOtpPage(res, email, token, otpPlain) {
  const tokenStr = token ? String(token) : "";
  const appMagicUrl = tokenStr
    ? `mapsky://auth/magic?token=${encodeURIComponent(tokenStr)}`
    : "mapsky://";
  const code = otpPlain && /^\d{6}$/.test(String(otpPlain)) ? String(otpPlain) : "";
  const codeHtml = code
    ? `<div id="otpCodeReveal" style="display:none;margin:14px 0;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
        <div style="font-size:12px;color:#6b7684;margin-bottom:6px">您的驗證碼</div>
        <div style="font-size:28px;font-weight:800;letter-spacing:0.35em;color:#2f6fed">${code}</div>
      </div>`
    : `<div id="otpCodeReveal" style="display:none;margin:14px 0;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
        <div style="font-size:12px;color:#6b7684">驗證碼請至申請登入的 MapSky 查看，或重新寄送一次。</div>
      </div>`;

  const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>完成登入 - MapSky</title></head>
<body style="font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif;max-width:420px;margin:48px auto;padding:0 24px;text-align:center;color:#1f2937">
<h2 style="margin-bottom:8px">完成登入</h2>
<p id="probeStatus" style="color:#6b7280;line-height:1.7;font-size:14px">正在判斷是否為同一裝置，並嘗試開啟 MapSky App…</p>

<div id="sameDeviceBox" style="margin:20px 0;padding:18px 16px;background:#f0f7ff;border:1px solid #cfe0ff;border-radius:16px;text-align:left">
  <div style="font-weight:700;font-size:14px;margin-bottom:6px">同裝置登入</div>
  <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0 0 14px">若這支手機有安裝 MapSky，系統會自動嘗試跳回 App 完成登入（不必打驗證碼）。</p>
  <a id="openAppBtn" href="${appMagicUrl}" style="display:block;text-align:center;padding:13px 16px;background:#1d4ed8;color:#fff;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px">在 MapSky App 完成登入</a>
</div>

<div id="otpSection" style="opacity:0.35;pointer-events:none;transition:opacity 0.25s">
  <div style="margin:8px 0 6px;color:#9ca3af;font-size:12px">— 判斷未跳轉後顯示 —</div>
  <p style="color:#6b7280;line-height:1.6;font-size:13.5px">請使用下方驗證碼，在此瀏覽器登入。</p>
  ${codeHtml}
  <form id="otpForm">
    <input id="otpInput" maxlength="6" inputmode="numeric" autocomplete="one-time-code" style="width:100%;padding:14px;font-size:24px;letter-spacing:0.3em;text-align:center;box-sizing:border-box;border:1px solid #d1d5db;border-radius:12px"/>
    <button type="submit" id="otpBtn" style="margin-top:12px;width:100%;padding:14px;background:#111827;color:#fff;border:0;border-radius:999px;font-weight:700">驗證並登入</button>
  </form>
  <p id="otpErr" style="color:#b3261e;min-height:1.5em"></p>
</div>
<p style="margin-top:8px"><a href="/" style="color:#6b7280;font-size:13.5px">回到 MapSky</a></p>
<script>(function(){
  var appUrl = ${JSON.stringify(appMagicUrl)};
  var statusEl = document.getElementById("probeStatus");
  var otpSection = document.getElementById("otpSection");
  var reveal = document.getElementById("otpCodeReveal");
  var probed = false;

  function enableOtp(msg) {
    if (probed) return;
    probed = true;
    if (statusEl) statusEl.textContent = msg || "無法自動開啟 App。以下是驗證碼，請輸入後登入。";
    if (otpSection) {
      otpSection.style.opacity = "1";
      otpSection.style.pointerEvents = "auto";
    }
    if (reveal) reveal.style.display = "block";
    try { document.getElementById("otpInput").focus(); } catch (e) {}
  }

  function tryOpenApp() {
    try {
      var a = document.createElement("a");
      a.href = appUrl;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {}
    try { window.location.href = appUrl; } catch (e2) {}
  }

  setTimeout(tryOpenApp, 200);
  setTimeout(function () {
    if (!document.hidden) enableOtp();
  }, 2000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) setTimeout(function () { enableOtp(); }, 400);
  });

  var f=document.getElementById("otpForm"),i=document.getElementById("otpInput"),b=document.getElementById("otpBtn"),e=document.getElementById("otpErr");
  var email=${JSON.stringify(email)};
  i.oninput=function(){i.value=i.value.replace(/\D/g,"").slice(0,6)};
  f.onsubmit=async function(ev){
    ev.preventDefault();
    var c=(i.value||"").replace(/\D/g,"").slice(0,6);
    if(c.length!==6){e.textContent="請輸入 6 位驗證碼";return;}
    b.disabled=true;e.textContent="";
    try{
      var r=await fetch("/api/auth/login?provider=email&action=verify-code",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({email:email,code:c})});
      var d=await r.json().catch(function(){return{};});
      if(r.ok&&d.ok){
        if(d.xchg){
          var app="mapsky://login-complete?xchg="+encodeURIComponent(d.xchg);
          try{location.href=app;}catch(z){}
          setTimeout(function(){location.href="/?login=success";},1600);
          return;
        }
        location.href="/?login=success";return;
      }
      if(d.reason==="wrong-code") e.textContent="驗證碼不正確或已過期";
      else if(d.reason==="too-many-attempts") e.textContent="嘗試次數過多，請重新寄一次";
      else e.textContent="驗證失敗，請再試一次";
    }catch(x){e.textContent="網路錯誤";}
    finally{b.disabled=false;}
  };
})();</script>
</body></html>`;
  res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
}

'''

cb = cb[:start] + new_fn + cb[end:]
cb_path.write_text(cb, encoding="utf-8")
print("callback page ok")
print("DONE")
