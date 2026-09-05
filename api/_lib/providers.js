// OAuth provider 設定 —— 網頁版
//
// ⚠️ 重要：所有 clientId / clientSecret 一律從環境變數讀取，絕對不要寫死在程式碼裡。
// 在 Vercel 專案的 Settings → Environment Variables 裡設定下列變數（見 .env.example）。
// 這個檔案只在 serverless function（伺服器端）執行，不會被打包進前端，
// 所以 clientSecret 不會外流到瀏覽器 —— 但前提是你「真的」把它放在環境變數，
// 而不是留在這個檔案裡。

function baseUrl(req) {
  // Vercel 會自動帶 x-forwarded-host / x-forwarded-proto，本機開發則退回 host header。
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
    scope: "openid profile",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    profileUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
    extraAuthParams: { access_type: "online", prompt: "select_account" },
    mapProfile: (json) => ({ id: json.sub, name: json.name, avatarUrl: json.picture || null }),
  },
  facebook: {
    id: "facebook",
    label: "Facebook",
    clientId: process.env.FACEBOOK_CLIENT_ID,
    clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
    scope: "public_profile",
    authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    tokenMethod: "GET", // Facebook 官方文件是用 GET + query string 換 token
    profileUrl: "https://graph.facebook.com/me?fields=id,name,picture.type(large)",
    mapProfile: (json) => ({
      id: json.id,
      name: json.name,
      avatarUrl: json.picture?.data?.url || null,
    }),
  },
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
    mapProfile: (json) => ({ id: json.id, name: json.displayName, avatarUrl: null }),
  },
  discord: {
    id: "discord",
    label: "Discord",
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    scope: "identify",
    authorizeUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    profileUrl: "https://discord.com/api/users/@me",
    mapProfile: (json) => ({
      id: json.id,
      name: json.global_name || json.username,
      avatarUrl: json.avatar ? `https://cdn.discordapp.com/avatars/${json.id}/${json.avatar}.png` : null,
    }),
  },
  github: {
    id: "github",
    label: "GitHub",
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    scope: "read:user",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    profileUrl: "https://api.github.com/user",
    mapProfile: (json) => ({ id: json.id, name: json.name || json.login, avatarUrl: json.avatar_url || null }),
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
    mapProfile: (json) => ({ id: json.sub, name: json.name, avatarUrl: json.picture || null }),
  },
};

function isConfigured(providerId) {
  const p = PROVIDERS[providerId];
  return Boolean(p && p.clientId && p.clientSecret !== undefined);
}

module.exports = { PROVIDERS, isConfigured, redirectUriFor, baseUrl };
