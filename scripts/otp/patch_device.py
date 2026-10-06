#!/usr/bin/env python3
from pathlib import Path

src = Path("api/auth/callback.js").read_text(encoding="utf-8")
if "isSameDevice" not in src:
    if "magic-link-device-mismatch" not in src:
        src = src.replace(
            '"magic-link-used":',
            '"magic-link-device-mismatch": {\n    title: "請改用驗證碼",\n    message: "這不是當初申請登入的裝置。請回到原本的裝置點連結，或輸入信中的 6 位數驗證碼。",\n  },\n  "magic-link-used":',
        )
    old = (
        "  const usedKey = `magiclink:used:${token}`;\n\n"
        "  if (req.method === \"POST\") {\n"
        "    // 單次有效：真正消費的這一步才標記用過，防止信件被轉寄或連結外流後\n"
        "    // 重複使用。沒接 Redis 的環境（本機開發）就跳過這層，只靠 15 分鐘的\n"
        "    // 到期時間擋，不影響正常登入。\n"
        "    try {"
    )
    new = (
        "  const usedKey = `magiclink:used:${token}`;\n"
        "  const cookieDevice = String(parseCookies(req).mapsky_ml_device || \"\");\n"
        "  const boundDeviceId = payload.deviceId ? String(payload.deviceId) : \"\";\n"
        "  const isSameDevice = !boundDeviceId || (cookieDevice && cookieDevice === boundDeviceId);\n\n"
        "  if (req.method === \"POST\") {\n"
        "    if (!isSameDevice) {\n"
        "      return sendLoginError(res, \"magic-link-device-mismatch\");\n"
        "    }\n"
        "    // 單次有效：真正消費的這一步才標記用過，防止信件被轉寄或連結外流後\n"
        "    // 重複使用。沒接 Redis 的環境（本機開發）就跳過這層，只靠 15 分鐘的\n"
        "    // 到期時間擋，不影響正常登入。\n"
        "    try {"
    )
    if old not in src: raise SystemExit("post block missing")
    src = src.replace(old, new)
    marker = "  const verifyAction = `/api/auth/callback?provider=email&token=${encodeURIComponent(String(token))}`;"
    insert = open("scripts/otp/device_otp_insert.js.txt").read()
    if marker not in src: raise SystemExit("marker missing")
    src = src.replace(marker, insert + marker)
    src = src.replace("請稍候，如果幾秒內沒有自動繼續，請按下面的按鈕。", "已確認為同一裝置，請稍候。")
    Path("api/auth/callback.js").write_text(src, encoding="utf-8")
    print("callback ok")
else:
    print("callback already")

js = Path("public/web-shim.js").read_text(encoding="utf-8")
if "getOrCreateMagicDeviceId" not in js:
    helper = open("scripts/otp/device_helper.js.txt").read()
    js = js.replace('  let magicLinkLastEmail = "";', '  let magicLinkLastEmail = "";\n' + helper)
    old = open("scripts/otp/device_fetch_old.txt").read()
    new = open("scripts/otp/device_fetch_new.txt").read()
    if old not in js: raise SystemExit("fetch missing")
    js = js.replace(old, new)
    Path("public/web-shim.js").write_text(js, encoding="utf-8")
    print("shim ok")
else:
    print("shim already")
