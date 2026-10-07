#!/usr/bin/env python3
from pathlib import Path

# --- login.js: return xchg after OTP verify ---
login_path = Path("api/auth/login.js")
login = login_path.read_text(encoding="utf-8")

old = '''  await client.del(otpKey);
  await client.del(triesKey);
  const magicLinkProfile = { id: email, name: email, avatarUrl: null, email };
  const resolved = await resolveLoginIdentity("email", magicLinkProfile);
  const sessionToken = sign({ provider: resolved.provider, profile: resolved.profile });
  res.setHeader("Set-Cookie", serializeCookie("nexora_session", sessionToken, { maxAge: 60 * 60 * 24 * 7 }));
  return res.status(200).json({ ok: true });
}'''

new = '''  await client.del(otpKey);
  await client.del(triesKey);
  const magicLinkProfile = { id: email, name: email, avatarUrl: null, email };
  const resolved = await resolveLoginIdentity("email", magicLinkProfile);
  const sessionToken = sign({ provider: resolved.provider, profile: resolved.profile });
  res.setHeader("Set-Cookie", serializeCookie("nexora_session", sessionToken, { maxAge: 60 * 60 * 24 * 7 }));

  // 給原生 App 用的短效交換碼（與 magic-link / OAuth 同一套 desktop_xchg）
  let xchg = null;
  try {
    xchg = crypto.randomBytes(24).toString("base64url");
    await client.set(`desktop_xchg:${xchg}`, sessionToken, { EX: 60 });
  } catch (e) {
    console.error("otp store xchg failed", e.message);
    xchg = null;
  }
  return res.status(200).json({ ok: true, xchg });
}'''

if "otp store xchg failed" in login:
    print("login already")
elif old in login:
    login = login.replace(old, new, 1)
    login_path.write_text(login, encoding="utf-8")
    print("login ok")
else:
    raise SystemExit("login verify block not found")

# --- callback.js: OTP page redirects to app after success ---
cb_path = Path("api/auth/callback.js")
cb = cb_path.read_text(encoding="utf-8")

old_js = "if(r.ok&&d.ok){location.href='/?login=success';return;}"
new_js = (
    "if(r.ok&&d.ok){"
    "if(d.xchg){"
    "var app='mapsky://login-complete?xchg='+encodeURIComponent(d.xchg);"
    "try{location.href=app;}catch(z){}"
    "setTimeout(function(){location.href='/?login=success';},1600);"
    "return;}"
    "location.href='/?login=success';return;}"
)

if "mapsky://login-complete?xchg='+encodeURIComponent(d.xchg)" in cb:
    print("otp page already")
elif old_js in cb:
    cb = cb.replace(old_js, new_js, 1)
    print("otp page ok")
else:
    # try in sendCrossDeviceOtpPage only
    if "location.href='/?login=success'" in cb:
        cb = cb.replace(
            "if(r.ok&&d.ok){location.href='/?login=success';return;}",
            new_js,
            1,
        )
        print("otp page soft ok")
    else:
        print("WARN otp page pattern")

# Update OTP page copy: after verify will open App
old_copy = "請回到<strong>原本的 MapSky</strong> 輸入信件裡的 6 位數驗證碼。<br>若要在這個瀏覽器登入，也可以直接在下方輸入同一組驗證碼。"
new_copy = "請輸入信件中的 <strong>6 位數驗證碼</strong>。<br>驗證成功後會嘗試跳回 MapSky App 完成登入。"
if old_copy in cb:
    cb = cb.replace(old_copy, new_copy, 1)
    print("copy ok")

cb_path.write_text(cb, encoding="utf-8")
print("DONE")
