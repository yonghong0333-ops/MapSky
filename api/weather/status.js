const { getApiKey, getCacheStatus } = require("../_lib/cwa");
const { requireSession } = require("../_lib/require-session");
const {
  isAdminSession,
  isSuperAdminSession,
  getSuperAdminIds,
  getDynamicAdmins,
  addDynamicAdmin,
  removeDynamicAdmin,
} = require("../_lib/admin");
const { PROVIDERS, isConfigured } = require("../_lib/providers");

// 一般登入使用者打這支只會拿到 hasKey（給前端判斷要不要顯示「尚未設定授權碼」提示）。
// 管理員加上 ?admin=1 才會多回傳後台管理要看的系統狀態，不是隨便誰都看得到。
// 管理員名單的查詢/指派/踢除也一起塞在這支（用 POST + action 區分），
// 不是另外開一支 api/admin/*.js，是因為 Vercel Hobby 方案 serverless function
// 數量有上限，這支本來就要求登入了，直接沿用比較省。
module.exports = async function handler(req, res) {
  const payload = requireSession(req, res);
  if (!payload) return;

  // ---- POST：管理員名單的指派/踢除，只有超級管理員能做 ----
  if (req.method === "POST") {
    if (req.query.admin !== "1") {
      return res.status(400).json({ ok: false, reason: "bad-request" });
    }
    if (!(await isSuperAdminSession(payload))) {
      return res.status(403).json({ ok: false, reason: "not-super-admin" });
    }
    const action = req.query.action;
    const body = req.body || {};
    try {
      if (action === "assign") {
        const { provider, id, name } = body;
        if (!provider || !id) return res.status(400).json({ ok: false, reason: "missing-provider-or-id" });
        const list = await addDynamicAdmin({ provider, id, name });
        return res.status(200).json({ ok: true, admins: list });
      }
      if (action === "revoke") {
        const { provider, id } = body;
        if (!provider || !id) return res.status(400).json({ ok: false, reason: "missing-provider-or-id" });
        const list = await removeDynamicAdmin({ provider, id });
        return res.status(200).json({ ok: true, admins: list });
      }
      return res.status(400).json({ ok: false, reason: "unknown-action" });
    } catch (e) {
      return res.status(400).json({ ok: false, reason: e.message });
    }
  }

  // ---- GET：一般狀態查詢 ----
  const basic = { hasKey: Boolean(getApiKey()) };
  if (req.query.admin !== "1") {
    return res.status(200).json(basic);
  }
  if (!(await isAdminSession(payload))) {
    return res.status(403).json({ ok: false, reason: "not-admin" });
  }

  const providers = Object.keys(PROVIDERS).map((id) => ({
    id,
    label: PROVIDERS[id].label,
    configured: isConfigured(id),
  }));

  const amSuperAdmin = await isSuperAdminSession(payload);
  const dynamicAdmins = await getDynamicAdmins();

  res.status(200).json({
    ...basic,
    isAdmin: true,
    isSuperAdmin: amSuperAdmin,
    me: { provider: payload.provider, id: payload.profile.id, name: payload.profile.name },
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 8) || null,
    region: process.env.VERCEL_REGION || null,
    providers,
    cache: getCacheStatus(),
    // 管理員名單：只有超級管理員看得到，也只有超級管理員能在前端指派/踢除。
    // 超級管理員名單只列出「provider:id」（沒有真名，因為那份資料只在環境
    // 變數裡，沒有登入紀錄可查真名）；一般管理員有存 name，可以顯示。
    admins: amSuperAdmin
      ? {
          superAdmins: getSuperAdminIds(),
          dynamicAdmins,
        }
      : null,
  });
};
