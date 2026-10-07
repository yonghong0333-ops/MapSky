#!/usr/bin/env python3
from pathlib import Path

CB = Path("api/auth/callback.js")

OLD = '''  const verifyAction = `/api/auth/callback?provider=email&token=${encodeURIComponent(String(token))}`;
  const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>登入 MapSky</title></head>
<body style="font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif;max-width:420px;margin:80px auto;padding:0 24px;text-align:center;color:#1f2937">
<h2>正在登入 MapSky…</h2>
<p style="color:#6b7280;line-height:1.7">同裝置驗證中，完成後會嘗試跳回 App。<br>若沒有自動繼續，請按下面的按鈕。</p>
<form id="magicLinkForm" method="POST" action="${verifyAction}">
  <button type="submit" style="margin-top:16px;padding:12px 28px;background:#1d4ed8;color:#fff;border:0;border-radius:999px;font-size:15px;font-weight:700;">繼續並開啟 App</button>
</form>
<script>
  setTimeout(function () {
    var f = document.getElementById("magicLinkForm");
    if (f.requestSubmit) f.requestSubmit(); else f.submit();
  }, 200);
</script>
</body></html>`;'''

NEW = '''  const verifyAction = `/api/auth/callback?provider=email&token=${encodeURIComponent(String(token))}`;
  const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>登入 MapSky</title>
<style>
  html,body{margin:0;height:100%;font-family:-apple-system,"Segoe UI","Noto Sans TC",sans-serif;background:linear-gradient(180deg,#5b9cf5 0%,#7eb6f7 45%,#c5e0fc 100%);color:#1e3a5f;overflow:hidden}
  .wrap{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
  .orbit{position:relative;width:88px;height:88px;display:flex;align-items:center;justify-content:center}
  .ring{position:absolute;inset:0;border-radius:50%;border:3px solid rgba(255,255,255,0.45);border-top-color:#fff;animation:spin 0.85s linear infinite}
  .sun{width:48px;height:48px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#ffe566,#f5a623);box-shadow:0 0 20px rgba(255,200,50,0.55)}
  .sun:after{content:"";position:absolute;inset:-10px;background:repeating-conic-gradient(from 0deg,#f5a623 0 8deg,transparent 8deg 30deg);border-radius:50%;opacity:0.85;z-index:-1}
  .label{margin-top:28px;font-size:15px;font-weight:600;color:rgba(30,58,95,0.85);letter-spacing:0.02em}
  form{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="wrap" role="status" aria-live="polite">
  <div class="orbit" aria-hidden="true"><span class="ring"></span><div class="sun"></div></div>
  <p class="label">正在登入…</p>
</div>
<form id="magicLinkForm" method="POST" action="${verifyAction}">
  <button type="submit">繼續</button>
</form>
<script>
  setTimeout(function () {
    var f = document.getElementById("magicLinkForm");
    if (f.requestSubmit) f.requestSubmit(); else f.submit();
  }, 120);
</script>
</body></html>`;'''


def main():
    c = CB.read_text(encoding="utf-8")
    if "正在登入…" in c and "class=\"orbit\"" in c:
        print("already spinner page")
        return
    if OLD not in c:
        raise SystemExit("old intermediate page not found")
    CB.write_text(c.replace(OLD, NEW, 1), encoding="utf-8")
    print("patched")


if __name__ == "__main__":
    main()
