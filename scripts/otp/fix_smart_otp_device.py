#!/usr/bin/env python3
"""Restore smart same-device OTP detection in public/web-shim.js

Bug: showOtp was hardcoded to true, so the phone that requested login
always showed the OTP form.

Fix: showOtp = forceOtp || !mobile
- Same device (mobile): only show "open email on same phone" hint
- Cross device / desktop: show OTP input
- forceOtp: always show OTP
"""
from pathlib import Path

p = Path("public/web-shim.js")
src = p.read_text(encoding="utf-8")

old_patterns = [
    # hardcoded true with comment
    """    const mobile = isMobileLoginDevice();
    const forceOtp = !!(opts && opts.forceOtp);
    // 一律顯示驗證碼：方便跨裝置時在 A 裝置看到／對照信件
    const showOtp = true;""",
    # simple hardcoded
    """    const mobile = isMobileLoginDevice();
    const forceOtp = !!(opts && opts.forceOtp);
    const showOtp = true;""",
]

new = """    // 系統自己判斷：同裝置靠 Magic Link 直接登入，跨裝置才需要驗證碼
    // - 手機（申請登入的裝置）：預設只顯示「請用同一支手機打開信件」提示，不強制驗證碼
    // - 非手機／桌面：顯示驗證碼輸入（常見跨裝置情境）
    // - forceOtp（例如從 need_otp 進來）：強制顯示驗證碼
    const mobile = isMobileLoginDevice();
    const forceOtp = !!(opts && opts.forceOtp);
    const showOtp = forceOtp || !mobile;"""

if "const showOtp = forceOtp || !mobile;" in src:
    print("already fixed")
elif any(o in src for o in old_patterns):
    for o in old_patterns:
        if o in src:
            p.write_text(src.replace(o, new, 1), encoding="utf-8")
            print("fixed")
            break
elif "const showOtp = true;" in src:
    p.write_text(src.replace("const showOtp = true;", "const showOtp = forceOtp || !mobile;", 1), encoding="utf-8")
    print("fixed simple")
else:
    raise SystemExit("no known pattern — check public/web-shim.js manually")
