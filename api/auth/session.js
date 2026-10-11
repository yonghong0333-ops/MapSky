const { parseCookies, serializeCookie } = require("../_lib/cookies");
const { PROVIDERS, isConfigured } = require("../_lib/providers");
const { verify } = require("../_lib/jwt");
const { isAdminSession, isSuperAdminSession } = require("../_lib/admin");
const { isBetaTester } = require("../_lib/beta-testers");
const { isAdventureSkip } = require("../_lib/adventure-skip");
const { getOrCreateMemberId } = require("../_lib/member-id");
const { getUserProfile, setUserProfile } = require("../_lib/user-profile");
const { getNicknameCooldownDays, isMaintenanceMode, getAdventureDailyLimitMinutes } = require("../_lib/app-settings");
const { getUsage, startSession, endSession } = require("../_lib/adventure-usage");
const { addSubscription, removeSubscription } = require("../_lib/push-store");
const { getPublicKey } = require("../_lib/web-push");
const { addIosToken, removeIosToken } = require("../_lib/apns-store");

module.exports = async function handler(req, res) {

  // Gemini AI 聊天：掛在這支避免超過 Vercel Hobby 12 支 function 上限。
  // POST /api/auth/session?action=ai-chat
  // body: { message: string, history?: [{ role: "user"|"model", text: string }] }
  // 不強制登入，方便 /ai 頁與 iOS WKWebView 直接呼叫；金鑰只在伺服器端讀取。
  // 多模型備援：主模型忙碌（high demand）時自動換下一顆。
  if (req.query.action === "ai-chat") {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      return res.status(500).json({ ok: false, error: "GEMINI_API_KEY not set" });
    }
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body || {};
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return res.status(400).json({ ok: false, error: "message is required" });
    }
    const history = Array.isArray(body.history) ? body.history : [];
    const contents = [];
    for (const h of history.slice(-20)) {
      if (!h || !h.text) continue;
      const role = h.role === "model" ? "model" : "user";
      contents.push({ role, parts: [{ text: String(h.text) }] });
    }
    contents.push({ role: "user", parts: [{ text: message }] });

    const preferred = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const models = [
      preferred,
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-flash-latest",
      "gemini-2.5-flash-lite",
      "gemini-3.8-flash",
    ].filter((m, i, arr) => m && arr.indexOf(m) === i);

    const payload = {
      contents,
      systemInstruction: {
        parts: [
          {
            text:
              "你是 MapSky 的 AI 助手，協助使用者了解台灣天氣、警特報與 App 使用。" +
              "請用繁體中文回答，語氣清楚簡潔。若不確定請誠實說明。",
          },
        ],
      },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    };

    let lastError = "Gemini request failed";
    for (const model of models) {
      const url =
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(model) +
        ":generateContent";
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify(payload),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          const msg =
            (data && data.error && data.error.message) ||
            "Gemini request failed";
          lastError = msg;
          const busy =
            r.status === 429 ||
            r.status === 503 ||
            /high demand|quota|unavailable|not found|no longer available/i.test(
              msg
            );
          if (busy) continue;
          const zh =
            /high demand/i.test(msg)
              ? "目前 AI 服務較忙碌，請稍後再試。"
              : msg;
          return res.status(r.status).json({ ok: false, error: zh, model });
        }
        const parts =
          data &&
          data.candidates &&
          data.candidates[0] &&
          data.candidates[0].content &&
          data.candidates[0].content.parts;
        const text = Array.isArray(parts)
          ? parts.map((p) => (p && p.text) || "").join("")
          : "";
        return res.status(200).json({ ok: true, text: text || "", model });
      } catch (e) {
        lastError = String((e && e.message) || e);
        continue;
      }
    }

    const zh = /high demand/i.test(lastError)
      ? "目前 AI 服務較忙碌，請稍後再試。"
      : lastError;
    return res.status(503).json({ ok: false, error: zh });
  }

  // 「登出」「可用的登入供應商清單」這兩個本來是獨立的 api/auth/logout.js、
  // api/auth/providers.js，併進這支（Vercel Hobby 方案一個部署最多 12 支
  // function，這支已經是現成要擴充的地方）。兩個都不需要先驗登入狀態，放在
  // 驗證 session 之前處理，登出時就算本來就沒登入也不會報錯、登入畫面還沒
  // 登入時也要能查供應商清單。
  if (req.query.action === "providers") {
    const list = Object.keys(PROVIDERS).map((id) => ({
      id,
      label: PROVIDERS[id].label,
      configured: isConfigured(id),
    }));
    return res.status(200).json({ providers: list });
  }

  if (req.query.action === "logout") {
    res.setHeader("Set-Cookie", serializeCookie("nexora_session", "", { maxAge: 0 }));
    return res.status(200).json({ ok: true });
  }

  const cookies = parseCookies(req);
  const payload = verify(cookies.nexora_session);
  if (!payload) {
    // 沒登入也要讓前端知道現在是不是維護模式，不然一般使用者的登入畫面
    // 沒辦法在還沒登入的狀態下就先鎖住。
    return res.status(200).json({ loggedIn: false, maintenanceMode: await isMaintenanceMode() });
  }

  // 動態島冒險的每日使用時間：查剩餘／開始（預扣）／結束（退回沒用完的）。
  // 每天上限由後台設定，05:00 換日，細節見 api/_lib/adventure-usage.js。
  // 一樣掛在這支（要驗登入、Vercel Hobby function 數量有上限），不另外開檔案。
  if (req.query.action === "adventure-usage" && req.method === "GET") {
    res.setHeader("Cache-Control", "no-store");
    const limit = await getAdventureDailyLimitMinutes();
    return res.status(200).json({ ok: true, ...(await getUsage(payload, limit)) });
  }

  if (req.method === "POST" && req.query.action === "adventure-start") {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const limit = await getAdventureDailyLimitMinutes();
    const result = await startSession(payload, body && body.minutes, limit);
    const status = result.ok ? 200 : result.reason === "daily-limit" ? 403 : 400;
    return res.status(status).json(result);
  }

  if (req.method === "POST" && req.query.action === "adventure-end") {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const limit = await getAdventureDailyLimitMinutes();
    const result = await endSession(payload, body && body.sessionId, body && body.usedMinutes, limit);
    return res.status(result.ok ? 200 : 400).json(result);
  }

  // Web Push 訂閱：登入後才能登記，存在 Redis，後台發公告時拿來推。
  if (req.method === "POST" && req.query.action === "push-subscribe") {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const sub = body && body.subscription;
    if (!sub || !sub.endpoint || !sub.keys) {
      return res.status(400).json({ ok: false, reason: "bad-subscription" });
    }
    await addSubscription(payload.sub || payload.userId || payload.id, sub);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "POST" && req.query.action === "push-unsubscribe") {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const endpoint = body && body.endpoint;
    if (endpoint) await removeSubscription(endpoint);
    return res.status(200).json({ ok: true });
  }

  // iOS 原生 App（Capacitor @capacitor/push-notifications）版本的訂閱／取消
  if (req.method === "POST" && req.query.action === "push-subscribe-ios") {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const token = body && body.token;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ ok: false, reason: "bad-token" });
    }
    const saved = await addIosToken(token);
    return res.status(200).json({ ok: true, token: saved });
  }

  if (req.method === "POST" && req.query.action === "push-unsubscribe-ios") {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const token = body && body.token;
    if (token) await removeIosToken(token);
    return res.status(200).json({ ok: true });
  }

  // 更新個人資料（暱稱、頭像、onboarded）
  if (req.method === "POST" && (req.query.action === "update-profile" || req.query.action === "profile")) {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body || {};
    const nickname = body.nickname;
    const avatarDataUrl = body.avatarDataUrl;
    const onboarded = body.onboarded;
    const patch = {};

    if (nickname !== undefined) {
      if (typeof nickname !== "string" || !nickname.trim()) {
        return res.status(400).json({ ok: false, reason: "invalid-nickname" });
      }
      patch.nickname = nickname.trim();
      patch.nicknameChangedAt = Date.now();
    }
    if (avatarDataUrl !== undefined) {
      if (avatarDataUrl !== null) {
        if (typeof avatarDataUrl !== "string" || !avatarDataUrl.startsWith("data:image/")) {
          return res.status(400).json({ ok: false, reason: "invalid-avatar" });
        }
        const approxBytes = (avatarDataUrl.length * 3) / 4;
        if (approxBytes > 400 * 1024) {
          return res.status(400).json({ ok: false, reason: "avatar-too-large" });
        }
      }
      patch.avatarDataUrl = avatarDataUrl;
    }
    if (onboarded !== undefined) {
      patch.onboarded = Boolean(onboarded);
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ ok: false, reason: "nothing-to-update" });
    }

    try {
      const saved = await setUserProfile(payload.provider, payload.profile.id, patch);
      return res.status(200).json({ ok: true, profile: saved });
    } catch (e) {
      return res.status(502).json({ ok: false, reason: "save-failed", message: e.message });
    }
  }

  const [isAdmin, memberId, custom, nicknameCooldownDays, maintenanceMode, betaTester, adventureSkipListed] = await Promise.all([
    isAdminSession(payload),
    getOrCreateMemberId(payload),
    getUserProfile(payload.provider, payload.profile.id),
    getNicknameCooldownDays(),
    isMaintenanceMode(),
    isBetaTester(payload),
    isAdventureSkip(payload),
  ]);

  const isSuperAdmin = isSuperAdminSession(payload);

  res.status(200).json({
    loggedIn: true,
    provider: payload.provider,
    profile: {
      ...payload.profile,
      nickname: (custom && custom.nickname) || null,
      avatarDataUrl: (custom && custom.avatarDataUrl) || null,
      onboarded: Boolean(custom && custom.onboarded),
      nicknameChangedAt: (custom && custom.nicknameChangedAt) || null,
    },
    isAdmin,
    memberId,
    nicknameCooldownDays,
    maintenanceMode,
    vapidPublicKey: getPublicKey(),
    adventureSkip: isSuperAdmin || adventureSkipListed,
    updateChannelAccess: {
      publicBeta: isSuperAdmin || betaTester,
      internalBeta: isSuperAdmin,
    },
  });
};
