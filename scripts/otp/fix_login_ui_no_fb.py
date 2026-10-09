#!/usr/bin/env python3
from pathlib import Path
import re

# --- providers: disable Facebook (keep object commented out of export path) ---
p_path = Path("api/_lib/providers.js")
p = p_path.read_text(encoding="utf-8")

if "facebook: null" in p or "/* facebook disabled" in p:
    print("providers already")
else:
    # Prefix facebook block so it's not in PROVIDERS active map - replace key with disabled
    old_fb = '''  facebook: {
    id: "facebook",
    label: "Facebook",
    clientId: process.env.FACEBOOK_CLIENT_ID,
    clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
    scope: "public_profile,email",
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    tokenMethod: "GET", // Facebook 官方文件是用 GET + query string 換 token
    profileUrl: "https://graph.facebook.com/me?fields=id,name,picture.type(large),email",
    mapProfile: (json) => ({
      id: json.id,
      name: json.name,
      avatarUrl: json.picture?.data?.url || null,
      email: json.email || null,
    }),
  },'''
    new_fb = '''  // Facebook OAuth 已下架（登入畫面不再提供）
  // facebook: { ... },'''
    if old_fb in p:
        p = p.replace(old_fb, new_fb, 1)
        print("providers remove fb")
    else:
        # soft: remove facebook entry via regex
        m = re.search(r"\n  facebook: \{[\s\S]*?\n  \},\n  microsoft:", p)
        if m:
            p = p[: m.start()] + "\n  // Facebook OAuth 已下架\n  microsoft:" + p[m.end() :]
            # wait that ate microsoft - fix
            p = p[: m.start()] + "\n  // Facebook OAuth 已下架\n" + p[m.start() + len(m.group(0)) - len("  microsoft:") :]
            print("providers soft")
        else:
            raise SystemExit("facebook block not found")
    p_path.write_text(p, encoding="utf-8")

# --- web-shim: primary only Google, filter out facebook ---
js_path = Path("public/web-shim.js")
js = js_path.read_text(encoding="utf-8")

js = js.replace(
    'const primaryIds = ["google", "facebook"];',
    'const primaryIds = ["google"];',
)
js = js.replace(
    "// 未登入：Google／Facebook 預設顯示，其他收在「更多登入方式」（無藍底按鈕）",
    "// 未登入：Google 預設顯示，其他收在「更多登入方式」",
)
# Filter facebook from any provider list used for buttons
if "p.id !== \"facebook\"" not in js and "filterFacebook" not in js:
    old_load = "    const { providers } = await getJson(\"/api/auth/session?action=providers\");\n    return providers;"
    new_load = '''    const { providers } = await getJson("/api/auth/session?action=providers");
    // Facebook 已下架，前端一律過濾
    return (providers || []).filter((p) => p && p.id !== "facebook");'''
    if old_load in js:
        js = js.replace(old_load, new_load, 1)
        print("shim filter ok")
    else:
        print("WARN loadProviders")

# icon map can stay
js_path.write_text(js, encoding="utf-8")

# --- CSS: redesigned login card ---
css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")

if "LOGIN_UI_REDESIGN_V1" in css:
    print("css already")
else:
    css += '''

/* LOGIN_UI_REDESIGN_V1 — 無 Facebook、更清晰層級 */
.login-gate-card {
  width: min(100%, 380px);
  padding: 36px 28px 28px;
  border-radius: 28px;
  background:
    linear-gradient(165deg, rgba(255, 255, 255, 0.72) 0%, rgba(255, 255, 255, 0.42) 100%);
  border: 1px solid rgba(255, 255, 255, 0.55);
  box-shadow:
    0 24px 48px rgba(30, 60, 120, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
}
.login-gate-logo {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  margin: 0 auto 14px;
  display: block;
  box-shadow: 0 8px 20px rgba(47, 111, 237, 0.22);
}
.login-gate-title {
  margin: 0 0 6px;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.02em;
  text-align: center;
  color: #1e3a5f;
}
.login-gate-tagline {
  margin: 0 0 28px;
  text-align: center;
  font-size: 13.5px;
  color: rgba(30, 58, 95, 0.62);
  line-height: 1.5;
}
.login-gate-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.login-gate-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.88);
  color: #1f2937;
  font-size: 15px;
  font-weight: 600;
  box-shadow: 0 4px 14px rgba(30, 60, 120, 0.08);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.login-gate-btn[data-provider="google"] {
  background: #fff;
  border-color: rgba(66, 133, 244, 0.35);
  box-shadow: 0 6px 18px rgba(66, 133, 244, 0.18);
}
.login-gate-btn:active {
  transform: scale(0.98);
}
.login-gate-more-toggle {
  margin: 14px 0 4px;
  width: 100%;
  border: none;
  background: transparent;
  color: rgba(30, 58, 95, 0.55);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px;
  -webkit-appearance: none;
  appearance: none;
}
.login-gate-divider {
  margin: 18px 0 16px;
  color: rgba(30, 58, 95, 0.4);
  font-size: 12px;
  font-weight: 600;
}
.login-gate-magic-row {
  display: flex;
  align-items: center;
  gap: 0;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(47, 111, 237, 0.18);
  border-radius: 999px;
  padding: 4px 4px 4px 16px;
  box-shadow: 0 4px 14px rgba(30, 60, 120, 0.06);
}
.login-gate-magic-input {
  flex: 1;
  border: none;
  background: transparent;
  padding: 12px 8px;
  font-size: 15px;
  outline: none;
  color: #1f2937;
}
.login-gate-magic-submit {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(145deg, #4f8dfb, #2f6fed);
  color: #fff;
  box-shadow: 0 4px 12px rgba(47, 111, 237, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}
.login-gate-magic-submit:active {
  transform: scale(0.94);
}
'''
    css_path.write_text(css, encoding="utf-8")
    print("css ok")

# index comment cleanup optional
html_path = Path("public/index.html")
html = html_path.read_text(encoding="utf-8")
html = html.replace("Google／Facebook", "Google")
html = html.replace("Google／Facebook 等帳號", "Google 等帳號")
html_path.write_text(html, encoding="utf-8")
print("DONE")
