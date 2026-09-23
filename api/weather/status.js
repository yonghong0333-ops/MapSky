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
const { getNicknameCooldownDays, setNicknameCooldownDays, isMaintenanceMode, setMaintenanceMode } = require("../_lib/app-settings");
const { getAllSubscriptions, removeSubscription } = require("../_lib/push-store");
const { addAnnouncement, getAnnouncementsSince } = require("../_lib/announcements");
const { sendPush, ensureConfigured } = require("../_lib/web-push");
const { getBetaTesters, addBetaTester, removeBetaTester } = require("../_lib/beta-testers");
const { getAdventureSkipList, addAdventureSkip, removeAdventureSkip } = require("../_lib/adventure-skip");

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

    // 維護模式開關：一般管理員就能切，管理員自己不受這個開關影響
    // （前端判斷「是不是要鎖住畫面」時，管理員一律略過，見 web-shim.js）。
    if (action === "set-maintenance-mode") {
      if (!(await isAdminSession(payload))) {
        return res.status(403).json({ ok: false, reason: "not-admin" });
      }
      try {
        const saved = await setMaintenanceMode(body.enabled);
        return res.status(200).json({ ok: true, maintenanceMode: saved });
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
      // 同時存一份到公告紀錄，桌面版 App（收不到網頁推播）靠這份定時來拿。
      // 存失敗不影響原本的網頁推播。
      try {
        await addAnnouncement({ title, body: message, url });
      } catch (e) {
        console.error("addAnnouncement failed", e.message);
      }
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

    // 觸發桌面版（.exe 外殼）重新編譯＋發佈到 GitHub Releases：只有超級
    // 管理員能做，因為這會實際動到編譯/發版這種等級的操作。實際上是呼叫
    // GitHub 的 workflow_dispatch API 去啟動 .github/workflows/build-desktop.yml，
    // 真正的編譯在 GitHub Actions 的機器上跑，這支 API 只負責「觸發」，
    // 呼叫完就回應，不會等編譯跑完（大概要幾分鐘）。版本號（YY.N 規則）是
    // 在 workflow 裡面算的，這裡只決定要發哪個頻道。
    // 用的 token 存在伺服器端環境變數 GITHUB_ACTIONS_TOKEN，前端完全看不到。
    if (action === "publish-desktop") {
      if (!(await isSuperAdminSession(payload))) {
        return res.status(403).json({ ok: false, reason: "not-super-admin" });
      }
      const token = process.env.GITHUB_ACTIONS_TOKEN;
      if (!token) {
        return res.status(400).json({ ok: false, reason: "github-token-not-configured" });
      }
      // stable = 正式版（所有人）；public-beta = 公開測試版（名單裡的人+
      // 超級管理員）；internal-beta = 一般測試版（只有超級管理員）。
      const channel = ["stable", "public-beta", "internal-beta"].includes(body.channel)
        ? body.channel
        : "stable";
      // 觸發哪個分支：預設 main，之後這條分支合併到 main 之前，可以先用
      // 環境變數 GITHUB_DESKTOP_BUILD_REF 覆蓋成目前這條開發分支。
      const ref = process.env.GITHUB_DESKTOP_BUILD_REF || "main";
      try {
        const ghResp = await fetch(
          "https://api.github.com/repos/yonghong0333-ops/MapSky/actions/workflows/build-desktop.yml/dispatches",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ref, inputs: { channel } }),
          }
        );
        // GitHub 這支 API 成功會回 204 No Content，沒有 body 可以解析。
        if (ghResp.status !== 204) {
          const detail = await ghResp.text().catch(() => "");
          return res.status(502).json({ ok: false, reason: "github-dispatch-failed", detail: detail.slice(0, 300) });
        }
        return res.status(200).json({ ok: true });
      } catch (e) {
        return res.status(502).json({ ok: false, reason: "github-dispatch-error" });
      }
    }

    // 公開測試版資格名單的指派/踢除，只有超級管理員能做——跟管理員名單
    // 是分開的兩份名單：管理員管的是「後台管理」，這份管的是「桌面版能不能
    // 切到公開測試版頻道」，兩者互不影響。
    if (action === "list-beta-testers") {
      if (!(await isSuperAdminSession(payload))) {
        return res.status(403).json({ ok: false, reason: "not-super-admin" });
      }
      const testers = await getBetaTesters();
      return res.status(200).json({ ok: true, testers });
    }
    if (action === "add-beta-tester") {
      if (!(await isSuperAdminSession(payload))) {
        return res.status(403).json({ ok: false, reason: "not-super-admin" });
      }
      try {
        const { memberId } = body;
        if (!memberId || typeof memberId !== "string") {
          return res.status(400).json({ ok: false, reason: "missing-member-id" });
        }
        const resolved = await resolveMemberId(memberId.trim());
        if (!resolved) {
          return res.status(404).json({ ok: false, reason: "member-not-found" });
        }
        const testers = await addBetaTester(resolved);
        return res.status(200).json({ ok: true, testers });
      } catch (e) {
        return res.status(400).json({ ok: false, reason: "action-failed", message: e.message });
      }
    }
    if (action === "remove-beta-tester") {
      if (!(await isSuperAdminSession(payload))) {
        return res.status(403).json({ ok: false, reason: "not-super-admin" });
      }
      try {
        const { provider, id } = body;
        if (!provider || !id) return res.status(400).json({ ok: false, reason: "missing-provider-or-id" });
        const testers = await removeBetaTester({ provider, id });
        return res.status(200).json({ ok: true, testers });
      } catch (e) {
        return res.status(400).json({ ok: false, reason: "action-failed", message: e.message });
      }
    }

    // 「動態島冒險」略過名單的指派/踢除，只有超級管理員能做——跟上面的公開測試版
    // 資格名單是分開的兩份名單，各管各的，互不影響。
    if (action === "list-adventure-skip") {
      if (!(await isSuperAdminSession(payload))) {
        return res.status(403).json({ ok: false, reason: "not-super-admin" });
      }
      const list = await getAdventureSkipList();
      return res.status(200).json({ ok: true, list });
    }
    if (action === "add-adventure-skip") {
      if (!(await isSuperAdminSession(payload))) {
        return res.status(403).json({ ok: false, reason: "not-super-admin" });
      }
      try {
        const { memberId } = body;
        if (!memberId || typeof memberId !== "string") {
          return res.status(400).json({ ok: false, reason: "missing-member-id" });
        }
        const resolved = await resolveMemberId(memberId.trim());
        if (!resolved) {
          return res.status(404).json({ ok: false, reason: "member-not-found" });
        }
        const list = await addAdventureSkip(resolved);
        return res.status(200).json({ ok: true, list });
      } catch (e) {
        return res.status(400).json({ ok: false, reason: "action-failed", message: e.message });
      }
    }
    if (action === "remove-adventure-skip") {
      if (!(await isSuperAdminSession(payload))) {
        return res.status(403).json({ ok: false, reason: "not-super-admin" });
      }
      try {
        const { provider, id } = body;
        if (!provider || !id) return res.status(400).json({ ok: false, reason: "missing-provider-or-id" });
        const list = await removeAdventureSkip({ provider, id });
        return res.status(200).json({ ok: true, list });
      } catch (e) {
        return res.status(400).json({ ok: false, reason: "action-failed", message: e.message });
      }
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
  // 桌面版定時來問有沒有新公告：?announcements=1&since=<上次看到的時間戳(ms)>。
  // 一般登入使用者就能問（上面 requireSession 已經擋掉沒登入的）。
  if (req.query.announcements === "1") {
    const since = Number(req.query.since) || 0;
    try {
      const announcements = await getAnnouncementsSince(since, 10);
      return res.status(200).json({ ok: true, now: Date.now(), announcements });
    } catch (e) {
      return res.status(200).json({ ok: false, reason: "announcements-unavailable" });
    }
  }
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

  const [amSuperAdmin, dynamicAdmins, nicknameCooldownDays, maintenanceMode, betaTesters, adventureSkipList] = await Promise.all([
    isSuperAdminSession(payload),
    getDynamicAdmins(),
    getNicknameCooldownDays(),
    isMaintenanceMode(),
    getBetaTesters(),
    getAdventureSkipList(),
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
    maintenanceMode,
    // 管理員名單：只有超級管理員看得到，也只有超級管理員能在前端指派/踢除。
    // 超級管理員名單只列出「provider:id」（沒有真名，因為那份資料只在環境
    // 變數裡，沒有登入紀錄可查真名）；一般管理員有存 name，可以顯示。
    admins: amSuperAdmin
      ? {
          superAdmins: getSuperAdminIds(),
          dynamicAdmins,
        }
      : null,
    // 公開測試版資格名單，一樣只有超級管理員看得到/管得到。
    betaTesters: amSuperAdmin ? betaTesters : null,
    // 「動態島冒險」略過名單，一樣只有超級管理員看得到/管得到。
    adventureSkipList: amSuperAdmin ? adventureSkipList : null,
  });
};
