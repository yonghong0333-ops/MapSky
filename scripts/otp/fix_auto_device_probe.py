#!/usr/bin/env python3
from pathlib import Path

cb_path = Path("api/auth/callback.js")
cb = cb_path.read_text(encoding="utf-8")

start = cb.find("function sendCrossDeviceOtpPage(res, email, token)")
if start < 0:
    start = cb.find("function sendCrossDeviceOtpPage(res, email)")
end = cb.find("// 桌面版登入的備援驗證", start)
if start < 0 or end < 0:
    raise SystemExit(f"bounds start={start} end={end}")

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
<p id="probeStatus" style="color:#6b7280;line-height:1.7;font-size:14px">正在判斷是否為同一裝置，並嘗試開啟 MapSky App…</p>

<div id="sameDeviceBox" style="margin:20px 0;padding:18px 16px;background:#f0f7ff;border:1px solid #cfe0ff;border-radius:16px;text-align:left">
  <div style="font-weight:700;font-size:14px;margin-bottom:6px">同裝置登入</div>
  <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0 0 14px">若這支手機有安裝 MapSky，系統會自動嘗試跳回 App 完成登入（不必打驗證碼）。</p>
  <a id="openAppBtn" href="${appMagicUrl}" style="display:block;text-align:center;padding:13px 16px;background:#1d4ed8;color:#fff;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px">在 MapSky App 完成登入</a>
</div>

<div id="otpSection" style="opacity:0.35;pointer-events:none;transition:opacity 0.25s">
  <div style="margin:8px 0 6px;color:#9ca3af;font-size:12px">— 其他裝置／未跳轉時 —</div>
  <p style="color:#6b7280;line-height:1.6;font-size:13.5px">請輸入信件中的 6 位數驗證碼，在此瀏覽器登入。</p>
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
  var probed = false;

  function enableOtp(msg) {
    if (probed) return;
    probed = true;
    if (statusEl) statusEl.textContent = msg || "無法自動開啟 App（可能是其他裝置，或系統擋下跳轉）。請輸入驗證碼，或再點上方按鈕。";
    if (otpSection) {
      otpSection.style.opacity = "1";
      otpSection.style.pointerEvents = "auto";
    }
    try { document.getElementById("otpInput").focus(); } catch (e) {}
  }

  // 此裝置自行嘗試同裝置路徑：用自訂 scheme 開 App（有 cookie 的 WebView）
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

  // 頁面一載入就嘗試（郵件內建瀏覽器有時仍允許使用者點連結後的首次導向）
  setTimeout(tryOpenApp, 200);

  // 若約 2 秒後還留在此頁 → 視為不同裝置或未裝 App → 開放驗證碼
  setTimeout(function () {
    if (!document.hidden) enableOtp();
  }, 2000);

  // 使用者從 App 切回來仍停在這頁 → 也開放驗證碼
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) setTimeout(function () { enableOtp(); }, 400);
  });

  var f=document.getElementById("otpForm"),i=document.getElementById("otpInput"),b=document.getElementById("otpBtn"),e=document.getElementById("otpErr");
  var email=${JSON.stringify(email)};
  i.oninput=function(){i.value=i.value.replace(/\D/g,"").slice(0,6)};
  f.onsubmit=async function(ev){
    ev.preventDefault();
    var c=(i.value||"").replace(/\D/g,"").slice(0,6);
    if(c.length!==6){e.textContent="請輸入信件中的 6 位驗證碼";return;}
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
      else if(d.reason==="too-many-attempts") e.textContent="嘗試次數過多，請重新寄一次驗證碼";
      else if(d.reason==="otp-unavailable") e.textContent="驗證服務暫時無法使用，請稍後再試";
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
print("ok", "tryOpenApp" in cb)
print("DONE")
