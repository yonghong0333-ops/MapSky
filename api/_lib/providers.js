// OAuth provider 設定 —— 網頁版
//
// ⚠️ 重要：所有 clientId / clientSecret 一律從環境變數讀取，絕對不要寫死在程式碼裡。
// 在 Vercel 專案的 Settings → Environment Variables 裡設定下列變數（見 .env.example）。
// 這個檔案只在 serverless function（伺服器端）執行，不會被打包進前端，
// 所以 clientSecret 不會外流到瀏覽器 —— 但前提是你「真的」把它放在環境變數，
// 而不是留在這個檔案裡。

function baseUrl(req) {
  // 優先使用固定的 SITE_URL 環境變數（例如 https://map-sky.vercel.app）。
  // 這樣不管使用者是從 production 網域還是 Vercel 自動產生的 preview 網域
  // （例如 map-4ypnia5ub-xxx.vercel.app）進來，組出來的 redirect_uri 永遠是
  // 同一個固定值，才會跟各家 OAuth 供應商後台登記的網址完全相符。
  // 沒有設定 SITE_URL 時（例如本機開發），才退回動態抓當下 host 的舊行為。
  if (process.env.SITE_URL) {
    return process.env.SITE_URL.replace(/\/$/, "");
  }
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function redirectUriFor(req, providerId) {
  const provider = PROVIDERS[providerId];
  if (provider && provider.redirectPath) {
    // 某些 IdP（例如 Azure AD）不允許 redirect_uri 帶查詢字串，
    // 所以改用乾淨路徑，由 vercel.json 的 rewrites 轉回同一支 callback.js。
    return `${baseUrl(req)}${provider.redirectPath}`;
  }
  return `${baseUrl(req)}/api/auth/callback?provider=${providerId}`;
}

const PROVIDERS = {
  google: {
    id: "google",
    label: "Google",
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    scope: "openid profile email",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    profileUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
    extraAuthParams: { access_type: "online", prompt: "select_account" },
    mapProfile: (json) => ({ id: json.sub, name: json.name, avatarUrl: json.picture || null, email: json.email || null }),
  },

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

  // Facebook OAuth 已下架（登入畫面不再提供）
  // facebook: { ... },
  microsoft: {
    id: "microsoft",
    label: "Microsoft",
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET, // 網頁版走 Authorization Code，需要 secret
    redirectPath: "/api/auth/callback/microsoft", // Azure AD 不允許 redirect_uri 帶查詢字串
    scope: "openid profile User.Read",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    profileUrl: "https://graph.microsoft.com/v1.0/me",
    mapProfile: (json) => ({ id: json.id, name: json.displayName, avatarUrl: null, email: json.mail || json.userPrincipalName || null }),
  },
  discord: {
    id: "discord",
    label: "Discord",
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    scope: "identify email",
    authorizeUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    profileUrl: "https://discord.com/api/users/@me",
    mapProfile: (json) => ({
      id: json.id,
      name: json.global_name || json.username,
      avatarUrl: json.avatar ? `https://cdn.discordapp.com/avatars/${json.id}/${json.avatar}.png` : null,
      email: json.email || null,
    }),
  },
  github: {
    id: "github",
    label: "GitHub",
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    scope: "read:user user:email",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    profileUrl: "https://api.github.com/user",
    mapProfile: (json) => ({ id: json.id, name: json.name || json.login, avatarUrl: json.avatar_url || null, email: json.email || null }),
  },
  yahoo: {
    id: "yahoo",
    label: "Yahoo",
    clientId: process.env.YAHOO_CLIENT_ID,
    clientSecret: process.env.YAHOO_CLIENT_SECRET,
    scope: "openid profile email",
    tokenAuthStyle: "basic", // Yahoo 要求用 Authorization: Basic 帶 client_id/secret
    authorizeUrl: "https://api.login.yahoo.com/oauth2/request_auth",
    tokenUrl: "https://api.login.yahoo.com/oauth2/get_token",
    profileUrl: "https://api.login.yahoo.com/openid/v1/userinfo",
    mapProfile: (json) => ({ id: json.sub, name: json.name, avatarUrl: json.picture || null, email: json.email || null }),
  },
};

function isConfigured(providerId) {
  const p = PROVIDERS[providerId];
  return Boolean(p && p.clientId && p.clientSecret !== undefined);
}

module.exports = { PROVIDERS, isConfigured, redirectUriFor, baseUrl };
