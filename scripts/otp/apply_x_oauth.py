#!/usr/bin/env python3
from pathlib import Path
import re
import struct
import zlib

def write_x_png(path: Path):
    """Write a simple 64x64 black X on transparent PNG without Pillow."""
    w = h = 64
    rows = []
    for y in range(h):
        row = [0]  # filter none
        for x in range(w):
            # thickness-ish X
            on = abs(x - y) <= 3 or abs(x - (w - 1 - y)) <= 3
            if 10 <= x <= 53 and 10 <= y <= 53 and on:
                row.extend([15, 15, 15, 255])
            else:
                row.extend([0, 0, 0, 0])
        rows.append(bytes(row))
    raw = b"".join(rows)
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)

# --- providers.js ---
prov = Path("api/_lib/providers.js")
t = prov.read_text(encoding="utf-8")
if 'id: "x"' not in t:
    block = '''
  // X (Twitter) OAuth 2.0 — 需 Vercel 環境變數 X_CLIENT_ID / X_CLIENT_SECRET
  // 並在 X Developer Portal 登記 callback：{SITE_URL}/api/auth/callback?provider=x
  x: {
    id: "x",
    label: "X",
    clientId: process.env.X_CLIENT_ID || process.env.TWITTER_CLIENT_ID,
    clientSecret: process.env.X_CLIENT_SECRET || process.env.TWITTER_CLIENT_SECRET,
    scope: "users.read tweet.read offline.access",
    pkce: true,
    tokenAuthStyle: "basic",
    authorizeUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    profileUrl: "https://api.twitter.com/2/users/me?user.fields=profile_image_url,name,username",
    mapProfile: (json) => {
      const d = json && json.data ? json.data : json;
      return {
        id: String(d.id),
        name: d.name || d.username || "X User",
        avatarUrl: d.profile_image_url || null,
        email: null,
      };
    },
  },
'''
    anchor = "  // Facebook OAuth 已下架（登入畫面不再提供）"
    if anchor in t:
        t = t.replace(anchor, block + "\n" + anchor, 1)
    else:
        t = t.replace("  microsoft: {", block + "\n  microsoft: {", 1)
    prov.write_text(t, encoding="utf-8")
    print("providers ok")
else:
    print("providers already")

# --- login.js PKCE ---
login = Path("api/auth/login.js")
lt = login.read_text(encoding="utf-8")
if "code_challenge" not in lt:
    old = """  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: provider.scope,
    state,
    ...(provider.extraAuthParams || {}),
  });

  const isDesktop = req.query.desktop === "1";

  const pending = String(parseCookies(req).oauth_state || "")
    .split(",")
    .filter((e) => /^[0-9a-f]{32}(~d)?$/.test(e))
    .slice(-4);
  const entry = isDesktop ? `${state}~d` : state;

  if (isDesktop) {
    try {
      const client = await getRedisClient();
      if (client) await client.set(`desktop_flow:${state}`, providerId, { EX: 900 });
    } catch (e) {
      console.error("desktop_flow store failed", e.message);
    }
  }

  res.setHeader("Set-Cookie", [
    serializeCookie("oauth_state", [...pending, entry].join(","), { maxAge: 600 }),
    serializeCookie("oauth_provider", providerId, { maxAge: 600 }),
    serializeCookie("oauth_desktop", "", { maxAge: 0 }),
  ]);
"""
    new = """  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: provider.scope,
    state,
    ...(provider.extraAuthParams || {}),
  });

  // X / Twitter OAuth 2.0 需要 PKCE
  let pkceCookie = "";
  if (provider.pkce) {
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");
    pkceCookie = serializeCookie("oauth_pkce", `${state}.${codeVerifier}`, { maxAge: 600 });
  }

  const isDesktop = req.query.desktop === "1";

  const pending = String(parseCookies(req).oauth_state || "")
    .split(",")
    .filter((e) => /^[0-9a-f]{32}(~d)?$/.test(e))
    .slice(-4);
  const entry = isDesktop ? `${state}~d` : state;

  if (isDesktop) {
    try {
      const client = await getRedisClient();
      if (client) await client.set(`desktop_flow:${state}`, providerId, { EX: 900 });
    } catch (e) {
      console.error("desktop_flow store failed", e.message);
    }
  }

  const cookiesOut = [
    serializeCookie("oauth_state", [...pending, entry].join(","), { maxAge: 600 }),
    serializeCookie("oauth_provider", providerId, { maxAge: 600 }),
    serializeCookie("oauth_desktop", "", { maxAge: 0 }),
  ];
  if (pkceCookie) cookiesOut.push(pkceCookie);
  res.setHeader("Set-Cookie", cookiesOut);
"""
    if old not in lt:
        raise SystemExit("login.js block not found")
    login.write_text(lt.replace(old, new, 1), encoding="utf-8")
    print("login pkce ok")
else:
    print("login already pkce")

# --- callback.js ---
cb = Path("api/auth/callback.js")
ct = cb.read_text(encoding="utf-8")
if "code_verifier" not in ct:
    old_ex = """async function exchangeToken(provider, code, redirectUri) {
  const body = {
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  };"""
    new_ex = """async function exchangeToken(provider, code, redirectUri, codeVerifier) {
  const body = {
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  };
  if (codeVerifier) body.code_verifier = codeVerifier;"""
    if old_ex not in ct:
        raise SystemExit("exchangeToken not found")
    ct = ct.replace(old_ex, new_ex, 1)
    ct, n = re.subn(
        r"await exchangeToken\(provider,\s*([^,]+),\s*([^)]+)\)",
        r"await exchangeToken(provider, \1, \2, codeVerifier)",
        ct,
        count=1,
    )
    if n != 1:
        print("warn exchange call n", n)
    marker = "const redirectUri = redirectUriFor(req, providerId);"
    if marker in ct and "oauth_pkce" not in ct:
        insert = """const redirectUri = redirectUriFor(req, providerId);
    // PKCE（X / Twitter）
    let codeVerifier = null;
    {
      const pkceRaw = String(cookies.oauth_pkce || "");
      const dot = pkceRaw.indexOf(".");
      if (dot > 0) {
        const pkceState = pkceRaw.slice(0, dot);
        const ver = pkceRaw.slice(dot + 1);
        if (pkceState === String(req.query.state || "") && ver) codeVerifier = ver;
      }
    }
"""
        ct = ct.replace(marker, insert, 1)
    if 'serializeCookie("oauth_provider", "", { maxAge: 0 })' in ct:
        ct = ct.replace(
            'serializeCookie("oauth_provider", "", { maxAge: 0 }),',
            'serializeCookie("oauth_provider", "", { maxAge: 0 }),\n      serializeCookie("oauth_pkce", "", { maxAge: 0 }),',
            1,
        )
    cb.write_text(ct, encoding="utf-8")
    print("callback ok")
else:
    print("callback already")

# --- web-shim ---
shim = Path("public/web-shim.js")
sj = shim.read_text(encoding="utf-8")
if 'x: "login-icons/x.png"' not in sj:
    sj = sj.replace(
        'google: "login-icons/google.png",',
        'google: "login-icons/google.png",\n    x: "login-icons/x.png",',
        1,
    )
    shim.write_text(sj, encoding="utf-8")
    print("shim ok")
else:
    print("shim already")

# --- env ---
env = Path(".env.example")
if env.exists() and "X_CLIENT_ID" not in env.read_text(encoding="utf-8"):
    env.write_text(env.read_text(encoding="utf-8") + "\n# X (Twitter) OAuth 2.0\nX_CLIENT_ID=\nX_CLIENT_SECRET=\n", encoding="utf-8")
    print("env ok")

# --- icon ---
Path("public/login-icons").mkdir(parents=True, exist_ok=True)
write_x_png(Path("public/login-icons/x.png"))
print("icon ok", Path("public/login-icons/x.png").stat().st_size)
print("DONE")
