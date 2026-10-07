#!/usr/bin/env python3
from pathlib import Path

CB = Path("api/auth/callback.js")

OLD_REDIRECT = '''    const appUrl = `mapsky://login-complete?xchg=${encodeURIComponent(xchg)}`;
    const ua = String(req.headers["user-agent"] || "");
    const looksMobile = /iPhone|iPad|iPod|Android/i.test(ua);

    // 同裝置：表單 POST 是使用者手勢觸發的導覽，優先 302 直接進 App
    // （桌面殼／已安裝 App 的手機通常接得住）。若環境擋自訂 scheme，
    // 客戶端仍會落到下面這頁，用按鈕／自動嘗試當備援。
    if (looksMobile) {
      res.writeHead(302, { Location: appUrl });
      return res.end();
    }'''

NEW_REDIRECT = '''    const appUrl = `mapsky://login-complete?xchg=${encodeURIComponent(xchg)}`;
    const ua = String(req.headers["user-agent"] || "");
    const looksMobile = /iPhone|iPad|iPod|Android/i.test(ua);
    // Already inside MapSky App WebView: cookie is set. Do NOT 302 to mapsky://
    // (unloads the page and triggers native "\u76ee\u524d\u7121\u6cd5\u9023\u7dda").
    const inNativeApp = /MapSkyiOS/i.test(ua) || /MapSkyApp/i.test(ua);

    if (inNativeApp) {
      res.writeHead(302, { Location: webUrl });
      return res.end();
    }

    // System browser (Safari/Chrome): open installed App via custom scheme
    if (looksMobile) {
      res.writeHead(302, { Location: appUrl });
      return res.end();
    }'''

OLD_GET = '''<h2>\u6b63\u5728\u767b\u5165 MapSky\u2026</h2>
<p style="color:#6b7280;line-height:1.7">\u540c\u88dd\u7f6e\u9a57\u8b49\u4e2d\uff0c\u5b8c\u6210\u5f8c\u6703\u5617\u8a66\u8df3\u56de App\u3002<br>\u82e5\u6c92\u6709\u81ea\u52d5\u7e7c\u7e8c\uff0c\u8acb\u6309\u4e0b\u9762\u7684\u6309\u9215\u3002</p>
<form id="magicLinkForm" method="POST" action="${verifyAction}">
  <button type="submit" style="margin-top:16px;padding:12px 28px;background:#1d4ed8;color:#fff;border:0;border-radius:999px;font-size:15px;font-weight:700;">\u7e7c\u7e8c\u4e26\u958b\u555f App</button>
</form>'''

NEW_GET = '''<h2>\u6b63\u5728\u767b\u5165 MapSky\u2026</h2>
<p style="color:#6b7280;line-height:1.7">\u540c\u88dd\u7f6e\u9a57\u8b49\u4e2d\uff0c\u8acb\u7a0d\u5019\u2026<br>\u82e5\u6c92\u6709\u81ea\u52d5\u7e7c\u7e8c\uff0c\u8acb\u6309\u4e0b\u9762\u7684\u6309\u9215\u3002</p>
<form id="magicLinkForm" method="POST" action="${verifyAction}">
  <button type="submit" style="margin-top:16px;padding:12px 28px;background:#1d4ed8;color:#fff;border:0;border-radius:999px;font-size:15px;font-weight:700;">\u7e7c\u7e8c</button>
</form>'''


def main():
    c = CB.read_text(encoding="utf-8")
    if "const inNativeApp = /MapSkyiOS" in c:
        print("redirect already patched")
    elif OLD_REDIRECT not in c:
        raise SystemExit("redirect block not found")
    else:
        c = c.replace(OLD_REDIRECT, NEW_REDIRECT, 1)
        print("redirect patched")

    if "\u540c\u88dd\u7f6e\u9a57\u8b49\u4e2d\uff0c\u8acb\u7a0d\u5019" in c or "同裝置驗證中，請稍候" in c:
        print("get page already patched")
    elif OLD_GET not in c:
        # try actual chinese in file
        old2 = OLD_GET.encode().decode("unicode_escape") if "\\u" in OLD_GET else OLD_GET
        # File uses real UTF-8 Chinese
        old_utf = '''<h2>正在登入 MapSky…</h2>
<p style="color:#6b7280;line-height:1.7">同裝置驗證中，完成後會嘗試跳回 App。<br>若沒有自動繼續，請按下面的按鈕。</p>
<form id="magicLinkForm" method="POST" action="${verifyAction}">
  <button type="submit" style="margin-top:16px;padding:12px 28px;background:#1d4ed8;color:#fff;border:0;border-radius:999px;font-size:15px;font-weight:700;">繼續並開啟 App</button>
</form>'''
        new_utf = '''<h2>正在登入 MapSky…</h2>
<p style="color:#6b7280;line-height:1.7">同裝置驗證中，請稍候…<br>若沒有自動繼續，請按下面的按鈕。</p>
<form id="magicLinkForm" method="POST" action="${verifyAction}">
  <button type="submit" style="margin-top:16px;padding:12px 28px;background:#1d4ed8;color:#fff;border:0;border-radius:999px;font-size:15px;font-weight:700;">繼續</button>
</form>'''
        if old_utf not in c:
            print("get page block not found, skip")
        else:
            c = c.replace(old_utf, new_utf, 1)
            print("get page patched")
    else:
        print("get page ok")

    CB.write_text(c, encoding="utf-8")
    print("done", CB.stat().st_size)


if __name__ == "__main__":
    main()
