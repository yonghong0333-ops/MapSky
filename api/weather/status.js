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
const { resolveMemberId } = require("../_lib/member-id");
const { PROVIDERS, isConfigured } = require("../_lib/providers");
const { getNicknameCooldownDays, setNicknameCooldownDays } = require("../_lib/app-settings");
const { getAllSubscriptions, removeSubscription } = require("../_lib/push-store");
const { sendPush, ensureConfigured } = require("../_lib/web-push");

// 一般登入使用者打這支只會拿到 hasKey（給前端判斷要不要顯示「尚未設定授權碼」提示）。
// 管理員加上 ?admin=1 才會多回傳後台管理要看的系統狀態，不是隨便誰都看得到。
// 管理員名單的查詢/指派/踢除也一起塞在這支（用 POST + action 區分），
// 不是另外開一支 api/admin/*.js，是因為 Vercel Hobby 方案 serverless function
// 數量有上限，這支本來就要求登入了，直接沿用比較省。
module.exports = async function handler(req, res) {
  const payload = requireSession(req, res);
  if (!payload) return;

  // ---- POST：後台操作，用 action 區分要做什麼 ----
  if (req.method === "POST") {
    if (req.query.admin !== "1") {
      return res.status(400).json({ ok: false, reason: "bad-request" });
    }
    const action = req.query.action;
    const body = req.body || {};

    // 改名冷卻天數：一般管理員就能改，不用到超級管理員
    if (action === "set-nickname-cooldown") {
      if (!(await isAdminSession(payload))) {
        return res.status(403).json({ ok: false, reason: "not-admin" });
      }
      try {
        const saved = await setNicknameCooldownDays(body.days);
        return res.status(200).json({ ok: true, nicknameCooldownDays: saved });
      } catch (e) {
        return res.status(400).json({ ok: false, reason: e.message });
      }
    }

    // 發公告推播：一般管理員就能發，不用到超級管理員
    if (action === "push-send") {
      if (!(await isAdminSession(payload))) {
        return res.status(403).json({ ok: false, reason: "not-admin" });
      }
      if (!ensureConfigured()) {
        return res.status(400).json({ ok: false, reason: "vapid-not-configured" });
      }
      const title = (body.title || "").trim();
      const message = (body.body || "").trim();
      if (!title || !message) {
        return res.status(400).json({ ok: false, reason: "missing-title-or-body" });
      }
      const url = (body.url || "/").trim() || "/";
      // 標題併進內文一起顯示，粗體標題欄位留空（iOS 一定會在標題下面自動
      // 插入「from MapSky」這行，程式改不了；把標題也塞進內文，
      // 排版上就會變成「(空白) / from MapSky / 標題：內容」）。
      const combinedBody = `${title}：${message}`;
      const subs = await getAllSubscriptions();
      let sent = 0;
      let expired = 0;
      let failed = 0;
      await Promise.all(
        subs.map(async (sub) => {
          const result = await sendPush(sub, { title: "", body: combinedBody, url });
          if (result.ok) {
            sent += 1;
          } else if (result.expired) {
            expired += 1;
            await removeSubscription(sub.endpoint);
          } else {
            failed += 1;
          }
        })
      );
      return res.status(200).json({ ok: true, total: subs.length, sent, expired, failed });
    }

    // 管理員名單的指派/踢除，只有超級管理員能做
    if (!(await isSuperAdminSession(payload))) {
      return res.status(403).json({ ok: false, reason: "not-super-admin" });
    }
    try {
      if (action === "assign") {
        const { memberId } = body;
        if (!memberId) return res.status(400).json({ ok: false, reason: "missing-member-id" });
        const info = await resolveMemberId(memberId);
        if (!info) return res.status(404).json({ ok: false, reason: "member-id-not-found" });
        const list = await addDynamicAdmin(info);
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

  const [amSuperAdmin, dynamicAdmins, nicknameCooldownDays] = await Promise.all([
    isSuperAdminSession(payload),
    getDynamicAdmins(),
    getNicknameCooldownDays(),
  ]);

  res.status(200).json({
    ...basic,
    isAdmin: true,
    isSuperAdmin: amSuperAdmin,
    me: { provider: payload.provider, id: payload.profile.id, name: payload.profile.name },
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 8) || null,
    region: process.env.VERCEL_REGION || null,
    providers,
    cache: getCacheStatus(),
    nicknameCooldownDays,
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
