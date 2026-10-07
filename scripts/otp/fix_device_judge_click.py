#!/usr/bin/env python3
from pathlib import Path

cb_path = Path("api/auth/callback.js")
cb = cb_path.read_text(encoding="utf-8")

# Replace sendCrossDeviceOtpPage to accept token and offer App open for same-phone
old_fn_start = "function sendCrossDeviceOtpPage(res, email) {"
if "function sendCrossDeviceOtpPage(res, email, token)" in cb:
    print("otp page signature already")
else:
    if old_fn_start not in cb:
        raise SystemExit("sendCrossDeviceOtpPage not found")
    # Replace whole function until closing before consumeDesktopFlow
    start = cb.find(old_fn_start)
    end = cb.find("// 桌面版登入的備援驗證", start)
    if start < 0 or end < 0:
        raise SystemExit("function bounds not found")

    new_fn = r'''function sendCrossDeviceOtpPage(res, email, token) {
  const tokenStr = token ? String(token) : "";
  const appMagicUrl = tokenStr
    ? `mapsky://auth/magic?token=${encodeURIComponent(tokenStr)}`
    : "mapsky://";
  const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>完成登入 - MapSky</title></head>
<body style="font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif;max-width:420px;margin:48px auto;padding:0 24px;text-align:center;color:#1f2937">
<h2 style="margin-bottom:8px">完成登入</h2>
<p style="color:#6b7280;line-height:1.7;font-size:14px">系統判斷此瀏覽器與申請登入的裝置<strong>不同</strong>（常見於郵件 App 內建瀏覽器）。</p>

<div style="margin:24px 0;padding:18px 16px;background:#f0f7ff;border:1px solid #cfe0ff;border-radius:16px;text-align:left">
  <div style="font-weight:700;font-size:14px;margin-bottom:6px">同一支手機？</div>
  <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0 0 14px">請用 MapSky App 開啟，系統會用 App 內的裝置資訊直接完成登入（交換碼），不必再打驗證碼。</p>
  <a href="${appMagicUrl}" style="display:block;text-align:center;padding:13px 16px;background:#1d4ed8;color:#fff;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px">在 MapSky App 完成登入</a>
</div>

<div style="margin:8px 0 6px;color:#9ca3af;font-size:12px">— 其他裝置請輸入驗證碼 —</div>
<p style="color:#6b7280;line-height:1.6;font-size:13.5px">請輸入信件中的 6 位數驗證碼，在此裝置登入。</p>
<form id="otpForm">
  <input id="otpInput" maxlength="6" inputmode="numeric" autocomplete="one-time-code" style="width:100%;padding:14px;font-size:24px;letter-spacing:0.3em;text-align:center;box-sizing:border-box;border:1px solid #d1d5db;border-radius:12px"/>
  <button type="submit" id="otpBtn" style="margin-top:12px;width:100%;padding:14px;background:#111827;color:#fff;border:0;border-radius:999px;font-weight:700">驗證並登入</button>
</form>
<p id="otpErr" style="color:#b3261e;min-height:1.5em"></p>
<p style="margin-top:8px"><a href="/" style="color:#6b7280;font-size:13.5px">回到 MapSky</a></p>
<script>(function(){
  var f=document.getElementById('otpForm'),i=document.getElementById('otpInput'),b=document.getElementById('otpBtn'),e=document.getElementById('otpErr');
  var email=${JSON.stringify(email)};
  i.oninput=function(){i.value=i.value.replace(/\D/g,'').slice(0,6)};
  f.onsubmit=async function(ev){
    ev.preventDefault();
    var c=(i.value||'').replace(/\D/g,'').slice(0,6);
    if(c.length!==6){e.textContent='請輸入信件中的 6 位驗證碼';return;}
    b.disabled=true;e.textContent='';
    try{
      var r=await fetch('/api/auth/login?provider=email&action=verify-code',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({email:email,code:c})});
      var d=await r.json().catch(function(){return{}});
      if(r.ok&&d.ok){
        if(d.xchg){
          var app='mapsky://login-complete?xchg='+encodeURIComponent(d.xchg);
          try{location.href=app;}catch(z){}
          setTimeout(function(){location.href='/?login=success';},1600);
          return;
        }
        location.href='/?login=success';return;
      }
      if(d.reason==='wrong-code') e.textContent='驗證碼不正確或已過期';
      else if(d.reason==='too-many-attempts') e.textContent='嘗試次數過多，請重新寄一次驗證碼';
      else if(d.reason==='otp-unavailable') e.textContent='驗證服務暫時無法使用，請稍後再試';
      else e.textContent='驗證失敗，請再試一次';
    }catch(x){e.textContent='網路錯誤';}
    finally{b.disabled=false;}
  };
  setTimeout(function(){i.focus()},100);
})();</script>
</body></html>`;
  res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
}

'''
    cb = cb[:start] + new_fn + cb[end:]
    print("otp page replaced")

# Update call sites to pass token
cb = cb.replace(
    "return sendCrossDeviceOtpPage(res, payload.email);",
    "return sendCrossDeviceOtpPage(res, payload.email, token);",
)
print("call sites", cb.count("sendCrossDeviceOtpPage(res, payload.email, token)"))

cb_path.write_text(cb, encoding="utf-8")

# --- web-shim: handle mapsky://auth/magic?token= ---
js_path = Path("public/web-shim.js")
js = js_path.read_text(encoding="utf-8")

old_listener = '''      App.addListener("appUrlOpen", async ({ url }) => {
        let xchg;
        try {
          xchg = new URL(url).searchParams.get("xchg");
        } catch {
          return;
        }
        if (!xchg) return;
        const Browser = capPlugin("Browser");
        if (Browser && Browser.close) {
          try { await Browser.close(); } catch { /* 忽略，可能本來就已經關了 */ }
        }
        window.location.href = `/api/auth/login?xchg=${encodeURIComponent(xchg)}&redirect=1`;
      });'''

new_listener = '''      App.addListener("appUrlOpen", async ({ url }) => {
        let xchg = null;
        let magicToken = null;
        try {
          const u = new URL(url);
          xchg = u.searchParams.get("xchg");
          magicToken = u.searchParams.get("token");
        } catch {
          return;
        }
        const Browser = capPlugin("Browser");
        if (Browser && Browser.close) {
          try { await Browser.close(); } catch { /* 忽略，可能本來就已經關了 */ }
        }
        // Email 驗證：用 App 內建 WebView 開啟 callback（帶得到 device cookie）
        // → 判定為同裝置 → 直接交換碼完成登入，不必打驗證碼
        if (magicToken) {
          window.location.href = `/api/auth/callback?provider=email&token=${encodeURIComponent(magicToken)}`;
          return;
        }
        if (!xchg) return;
        window.location.href = `/api/auth/login?xchg=${encodeURIComponent(xchg)}&redirect=1`;
      });'''

if "magicToken = u.searchParams.get" in js:
    print("shim already")
elif old_listener in js:
    js = js.replace(old_listener, new_listener, 1)
    js_path.write_text(js, encoding="utf-8")
    print("shim ok")
else:
    # softer
    if 'xchg = new URL(url).searchParams.get("xchg")' in js:
        js = js.replace(
            '''        let xchg;
        try {
          xchg = new URL(url).searchParams.get("xchg");
        } catch {
          return;
        }
        if (!xchg) return;
        const Browser = capPlugin("Browser");
        if (Browser && Browser.close) {
          try { await Browser.close(); } catch { /* 忽略，可能本來就已經關了 */ }
        }
        window.location.href = `/api/auth/login?xchg=${encodeURIComponent(xchg)}&redirect=1`;''',
            '''        let xchg = null;
        let magicToken = null;
        try {
          const u = new URL(url);
          xchg = u.searchParams.get("xchg");
          magicToken = u.searchParams.get("token");
        } catch {
          return;
        }
        const Browser = capPlugin("Browser");
        if (Browser && Browser.close) {
          try { await Browser.close(); } catch { /* 忽略，可能本來就已經關了 */ }
        }
        if (magicToken) {
          window.location.href = `/api/auth/callback?provider=email&token=${encodeURIComponent(magicToken)}`;
          return;
        }
        if (!xchg) return;
        window.location.href = `/api/auth/login?xchg=${encodeURIComponent(xchg)}&redirect=1`;''',
            1,
        )
        js_path.write_text(js, encoding="utf-8")
        print("shim soft ok")
    else:
        raise SystemExit("shim listener not found")

print("DONE")
