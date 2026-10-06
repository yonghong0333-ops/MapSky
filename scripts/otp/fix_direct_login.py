#!/usr/bin/env python3
from pathlib import Path

src = Path("api/auth/callback.js").read_text(encoding="utf-8")

if "isSameDevice" not in src and "verifyAction" in src:
    print("already fixed")
else:
    old_post = (
        '  if (req.method === "POST") {\n'
        '    if (!isSameDevice) {\n'
        '      return sendLoginError(res, "magic-link-device-mismatch");\n'
        '    }\n'
        '    // 單次有效：'
    )
    new_post = (
        '  if (req.method === "POST") {\n'
        '    // 單次有效：'
    )
    if old_post in src:
        src = src.replace(old_post, new_post)
        print("removed POST device gate")
    else:
        print("POST gate already gone or different")

    start = src.find("  if (!isSameDevice) {")
    if start >= 0:
        end = src.find("  const verifyAction =", start)
        if end < 0:
            raise SystemExit("verifyAction missing after isSameDevice")
        src = src[:start] + src[end:]
        print("removed GET cross-device page")

    src = src.replace(
        "已確認為同一裝置，請稍候。",
        "請稍候，如果幾秒內沒有自動繼續，請按下面的按鈕。",
    )

    old_vars = (
        "  const usedKey = `magiclink:used:${token}`;\n"
        '  const cookieDevice = String(parseCookies(req).mapsky_ml_device || "");\n'
        '  const boundDeviceId = payload.deviceId ? String(payload.deviceId) : "";\n'
        "  const isSameDevice = !boundDeviceId || (cookieDevice && cookieDevice === boundDeviceId);\n\n"
    )
    new_vars = "  const usedKey = `magiclink:used:${token}`;\n\n"
    if old_vars in src:
        src = src.replace(old_vars, new_vars)
        print("cleaned device vars")

    Path("api/auth/callback.js").write_text(src, encoding="utf-8")
    print("callback written")

if "isSameDevice" in Path("api/auth/callback.js").read_text(encoding="utf-8"):
    raise SystemExit("isSameDevice still present")
print("DONE")
