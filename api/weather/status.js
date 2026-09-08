const { getApiKey, getCacheStatus } = require("../_lib/cwa");
const { requireSession } = require("../_lib/require-session");
const { isAdminSession } = require("../_lib/admin");
const { PROVIDERS, isConfigured } = require("../_lib/providers");

// 一般登入使用者打這支只會拿到 hasKey（給前端判斷要不要顯示「尚未設定授權碼」提示）。
// 管理員加上 ?admin=1 才會多回傳後台管理要看的系統狀態，不是隨便誰都看得到。
// 沒有另外開一支 api/admin/*.js，是因為 Vercel Hobby 方案 serverless function
// 數量有上限，這支本來就要求登入了，直接沿用比較省。
module.exports = function handler(req, res) {
  const payload = requireSession(req, res);
  if (!payload) return;

  const basic = { hasKey: Boolean(getApiKey()) };
  if (req.query.admin !== "1") {
    return res.status(200).json(basic);
  }
  if (!isAdminSession(payload)) {
    return res.status(403).json({ ok: false, reason: "not-admin" });
  }

  const providers = Object.keys(PROVIDERS).map((id) => ({
    id,
    label: PROVIDERS[id].label,
    configured: isConfigured(id),
  }));

  res.status(200).json({
    ...basic,
    isAdmin: true,
    me: { provider: payload.provider, id: payload.profile.id, name: payload.profile.name },
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 8) || null,
    region: process.env.VERCEL_REGION || null,
    providers,
    cache: getCacheStatus(),
  });
};
