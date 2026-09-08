// 後台管理權限判斷 —— 沒有資料庫，用環境變數存一份白名單就好。
//
// 在 Vercel 專案的 Settings → Environment Variables 設定 ADMIN_IDS，
// 格式是「provider:id」用逗號分隔，例如：
//   facebook:1234567890,google:987654321
// provider 是登入方式（facebook/google/microsoft/discord/github/yahoo），
// id 是該登入方式回傳的使用者 id（登入後打開 /api/auth/session 就能看到
// 自己的 provider 跟 profile.id，把這兩個值組起來貼進 ADMIN_IDS 即可）。
function getAdminIds() {
  return (process.env.ADMIN_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAdminSession(payload) {
  if (!payload || !payload.provider || !payload.profile || !payload.profile.id) return false;
  const key = `${payload.provider}:${payload.profile.id}`;
  return getAdminIds().includes(key);
}

module.exports = { isAdminSession, getAdminIds };
