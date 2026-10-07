#!/usr/bin/env python3
from pathlib import Path

cb_path = Path("api/auth/callback.js")
cb = cb_path.read_text(encoding="utf-8")

old_success = '''    const appUrl = `mapsky://login-complete?xchg=${encodeURIComponent(xchg)}`;
    const appHtml = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>登入 MapSky</title></head>
<body style="font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif;max-width:420px;margin:80px auto;padding:0 24px;text-align:center;color:#1f2937">
<h2>登入成功 ✓</h2>
<p style="color:#6b7280;line-height:1.7">如果手機上已經安裝 MapSky，請點下面按鈕在 App 裡繼續；沒有安裝的話，點下面的連結用網頁版繼續就好。</p>
<p style="margin-top:28px;">
  <a href="${appUrl}" style="display:inline-block;padding:13px 30px;background:#1d4ed8;color:#fff;border-radius:999px;text-decoration:none;font-size:15px;font-weight:700;">在 MapSky App 中開啟</a>
</p>
<p style="margin-top:18px;"><a href="${webUrl}" style="color:#6b7280;text-decoration:underline;font-size:13.5px;">沒有安裝 App，繼續使用網頁版</a></p>
</body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(appHtml);
  }'''

new_success = r'''    const appUrl = `mapsky://login-complete?xchg=${encodeURIComponent(xchg)}`;
    const ua = String(req.headers["user-agent"] || "");
    const looksMobile = /iPhone|iPad|iPod|Android/i.test(ua);

    // 同裝置：表單 POST 是使用者手勢觸發的導覽，優先 302 直接進 App
    // （桌面殼／已安裝 App 的手機通常接得住）。若環境擋自訂 scheme，
    // 客戶端仍會落到下面這頁，用按鈕／自動嘗試當備援。
    if (looksMobile) {
      res.writeHead(302, { Location: appUrl });
      return res.end();
    }

    const appHtml = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>登入成功 - MapSky</title>
<meta http-equiv="refresh" content="0;url=${appUrl}">
</head>
<body style="font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif;max-width:420px;margin:80px auto;padding:0 24px;text-align:center;color:#1f2937">
<h2>登入成功 ✓</h2>
<p style="color:#6b7280;line-height:1.7">正在跳回 MapSky App…<br>若沒有自動開啟，請按下面按鈕。</p>
<p style="margin-top:28px;">
  <a id="openApp" href="${appUrl}" style="display:inline-block;padding:13px 30px;background:#1d4ed8;color:#fff;border-radius:999px;text-decoration:none;font-size:15px;font-weight:700;">開啟 MapSky App</a>
</p>
<p style="margin-top:18px;"><a href="${webUrl}" style="color:#6b7280;text-decoration:underline;font-size:13.5px;">使用網頁版繼續</a></p>
<script>
(function () {
  var url = ${JSON.stringify(appUrl)};
  function go() {
    try { window.location.href = url; } catch (e) {}
    try {
      var a = document.createElement("a");
      a.href = url;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
    } catch (e) {}
  }
  go();
  setTimeout(go, 400);
  // 若 1.8 秒後還在這個分頁，維持按鈕可見即可
})();
</script>
</body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(appHtml);
  }'''

if "正在跳回 MapSky App" in cb:
    print("callback already")
elif old_success in cb:
    cb = cb.replace(old_success, new_success, 1)
    print("callback success page ok")
else:
    # softer match around appUrl assignment
    marker = "const appUrl = `mapsky://login-complete?xchg=${encodeURIComponent(xchg)}`;"
    if marker not in cb:
        raise SystemExit("appUrl marker missing")
    start = cb.find(marker)
    end = cb.find("return res.status(200).send(appHtml);", start)
    if end < 0:
        raise SystemExit("send appHtml missing")
    end = end + len("return res.status(200).send(appHtml);")
    # Find closing of the POST block's success - include through that return
    cb = cb[:start] + new_success.split("const appUrl")[1]
    # messy - use different approach
    raise SystemExit("exact block not found - abort soft")

# Also improve GET intermediate page: auto-submit still, copy clearer for same-device
old_get = '''  const verifyAction = `/api/auth/callback?provider=email&token=${encodeURIComponent(String(token))}`;
  const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>登入 MapSky</title></head>
<body style="font-family:-apple-system,'Segoe UI','Noto Sans TC',sans-serif;max-width:420px;margin:80px auto;padding:0 24px;text-align:center;color:#1f2937">
<h2>正在登入 MapSky…</h2>
<p style="color:#6b7280;line-height:1.7">請稍候，如果幾秒內沒有自動繼續，請按下面的按鈕。</p>
<form id="magicLinkForm" method="POST" action="${verifyAction}">
  <button type="submit" style="margin-top:16px;padding:12px 28px;background:#1d4ed8;color:#fff;border:0;border-radius:999px;font-size:15px;font-weight:700;">繼續登入</button>
</form>
<script>
  setTimeout(function () {
    var f = document.getElementById("magicLinkForm");
    if (f.requestSubmit) f.requestSubmit(); else f.submit();
  }, 300);
</script>
</body></html>`;
  res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
}'''

new_get = '''  const verifyAction = `/api/auth/callback?provider=email&token=${encodeURIComponent(String(token))}`;
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
</body></html>`;
  res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
}'''

if "同裝置驗證中，完成後會嘗試跳回 App" in cb:
    print("get page already")
elif old_get in cb:
    cb = cb.replace(old_get, new_get, 1)
    print("get page ok")
else:
    print("WARN get page pattern")

cb_path.write_text(cb, encoding="utf-8")

# --- verify-code: also return exchange code so OTP success can open app ---
login_path = Path("api/auth/login.js")
login = login_path.read_text(encoding="utf-8")

# Find verify-code success return
if "xchg" in login and "verify-code" in login and "storeExchangeCode" in login:
    print("login xchg maybe already")
else:
    # need storeExchangeCode in login - it's in callback, not exported
    # Keep OTP verify returning ok; enhance client-side OTP success to go /?login=success
    # For OTP path, enhance sendCrossDeviceOtpPage success redirect later if needed
    print("login skip xchg export")

# Enhance OTP page success: after verify, try open app via /?login=success is web only.
# Add note on OTP page that same-phone should use link for auto app open.

print("DONE")
