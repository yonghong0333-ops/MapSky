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
const {
  userKeyFromPayload,
  listChats,
  getChat,
  saveChat,
  deleteChat,
} = require("../_lib/ai-chats");

module.exports = async function handler(req, res) {

  if (req.query.action === "ai-chats" || req.query.action === "ai-chat-get" ||
      req.query.action === "ai-chat-save" || req.query.action === "ai-chat-delete") {
    const cookies = parseCookies(req);
    const sessionPayload = verify(cookies.nexora_session);
    const uk = userKeyFromPayload(sessionPayload);
    if (!uk) {
      return res.status(401).json({ ok: false, error: "請先登入以使用雲端對話" });
    }

    if (req.query.action === "ai-chats" && req.method === "GET") {
      const chats = await listChats(uk.provider, uk.id);
      return res.status(200).json({ ok: true, chats, cloud: true });
    }

    if (req.query.action === "ai-chat-get" && req.method === "GET") {
      const chatId = String(req.query.id || "");
      if (!chatId) return res.status(400).json({ ok: false, error: "missing id" });
      const chat = await getChat(uk.provider, uk.id, chatId);
      if (!chat) return res.status(404).json({ ok: false, error: "not found" });
      return res.status(200).json({ ok: true, chat });
    }

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body || {};

    if (req.query.action === "ai-chat-save" && req.method === "POST") {
      try {
        const saved = await saveChat(uk.provider, uk.id, body);
        return res.status(200).json({ ok: true, chat: saved });
      } catch (e) {
        return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
      }
    }

    if (req.query.action === "ai-chat-delete" && req.method === "POST") {
      const chatId = String(body.id || "");
      if (!chatId) return res.status(400).json({ ok: false, error: "missing id" });
      try {
        await deleteChat(uk.provider, uk.id, chatId);
        return res.status(200).json({ ok: true });
      } catch (e) {
        return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
      }
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (req.query.action === "ai-chat") {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body || {};
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const image = body.image && typeof body.image === "object" ? body.image : null;
    const imageData = image && typeof image.data === "string" ? image.data.replace(/^data:[^;]+;base64,/, "") : "";
    const imageMime = image && typeof image.mimeType === "string" ? image.mimeType : "image/jpeg";
    const hasImage = Boolean(imageData);
    if (!message && !hasImage) {
      return res.status(400).json({ ok: false, error: "message or image is required" });
    }
    if (hasImage && imageData.length > 5.5 * 1024 * 1024) {
      return res.status(400).json({ ok: false, error: "圖片太大，請選較小的照片" });
    }

    const GEMINI_MODELS = [
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-flash-latest",
      "gemini-2.5-flash-lite",
      "gemini-3.8-flash",
      "gemini-2.5-pro",
      "gemini-3-flash-preview",
    ];
    const GROQ_MODELS = [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
    ];
    const GROQ_VISION_MODELS = [
      "meta-llama/llama-4-maverick-17b-128e-instruct",
      "qwen/qwen3.8-27b",
      "meta-llama/llama-4-scout-17b-16e-instruct",
      "llama-3.2-11b-vision-preview",
    ];

    const ALLOWED = GEMINI_MODELS.concat(GROQ_MODELS);
    const envDefault = process.env.AI_DEFAULT_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const clientModel = typeof body.model === "string" ? body.model.trim() : "";
    let preferred =
      clientModel && ALLOWED.indexOf(clientModel) !== -1 ? clientModel : envDefault;
    if (ALLOWED.indexOf(preferred) === -1) preferred = "gemini-2.5-flash";

    const isGroqModel = (m) =>
      GROQ_MODELS.indexOf(m) !== -1 ||
      GROQ_VISION_MODELS.indexOf(m) !== -1 ||
      String(m).startsWith("llama") ||
      String(m).startsWith("gemma") ||
      String(m).startsWith("mixtral") ||
      String(m).startsWith("qwen") ||
      String(m).startsWith("meta-llama") ||
      String(m).startsWith("openai/") ||
      String(m).indexOf("llama") !== -1;

    const systemText =
      "[Role & Directives]\n" +
      "你的名字是 Aether。你是內建於 MapSky 的專業工程與科學 AI 助手。回答涉及物理、數學、電子學等領域時，請遵守以下規則：\n" +
      "\n" +
      "[1. 數學與公式（手機可讀）]\n" +
      "- 公式一律用一般文字與 Unicode 符號書寫，方便在手機上直接閱讀。\n" +
      "- 範例：√2、sin(A+B)=sinA cosB + cosA sinB、45°、π、ω=2πf、V=110∠30° V、R=10 Ω。\n" +
      "- 分數用 a/b 或上下文字說明，不要使用 $、\\frac、\\circ 等任何 LaTeX 語法。\n" +
      "- 嚴禁輸出 $...$ 或 $$...$$，前端沒有公式渲染器，會變成空白破圖。\n" +
      "\n" +
      "[2. 電子學與基本電學符號]\n" +
      "- 電壓 V、v(t)；電流 I、i(t)；電阻 R、電導 G、阻抗 Z（單位 Ω、S）。\n" +
      "- 電容 C（F）、電感 L（H）；角頻率 ω=2πf、相位 θ。\n" +
      "- 交流相量：V = 110∠30° V。\n" +
      "- 二極體：熱電壓 VT≈26 mV、順向壓降 VD。\n" +
      "\n" +
      "[3. 排版]\n" +
      "- 比較或整理類內容可用 Markdown 表格，表格前後空一行。\n" +
      "\n" +
      "請用繁體中文回答，語氣清楚、親切有禮（適度客套），讓使用者感到被尊重與友善。\n" +
      "你可協助台灣天氣、警特報與 App 使用；若不確定請誠實說明。\n" +
      "嚴禁在回覆中提及 LaTeX、KaTeX、MathJax、排版標準、複製環境等字樣；直接給出公式與說明即可。";

    async function callGroq(model) {
      const key = process.env.GROQ_API_KEY;
      if (!key) throw new Error("GROQ_API_KEY not set");
      let useModel = model;
      if (hasImage && GROQ_VISION_MODELS.indexOf(model) === -1) {
        useModel = GROQ_VISION_MODELS[0];
      }
      const messages = [{ role: "system", content: systemText }];
      const history = Array.isArray(body.history) ? body.history : [];
      for (const h of history.slice(-20)) {
        if (!h || !h.text) continue;
        messages.push({
          role: h.role === "model" ? "assistant" : "user",
          content: String(h.text),
        });
      }
      if (hasImage) {
        messages.push({
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: "data:" + (imageMime || "image/jpeg") + ";base64," + imageData,
              },
            },
            {
              type: "text",
              text: message || "請描述這張圖片的內容，並用繁體中文回答。",
            },
          ],
        });
      } else {
        messages.push({ role: "user", content: message });
      }
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + key,
        },
        body: JSON.stringify({
          model: useModel,
          messages,
          temperature: 0.7,
          max_tokens: 8192,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg =
          (data && data.error && data.error.message) || "Groq request failed";
        const err = new Error(msg);
        err.status = r.status;
        err.busy =
          r.status === 429 ||
          r.status === 503 ||
          /rate limit|overloaded|unavailable|does not exist|do not have access|not found|decommissioned/i.test(msg);
        throw err;
      }
      const text =
        data &&
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content;
      return { text: text || "", model: useModel, provider: "groq" };
    }

    async function callGemini(model) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error("GEMINI_API_KEY not set");
      const history = Array.isArray(body.history) ? body.history : [];
      const contents = [];
      for (const h of history.slice(-20)) {
        if (!h || !h.text) continue;
        contents.push({
          role: h.role === "model" ? "model" : "user",
          parts: [{ text: String(h.text) }],
        });
      }
      const userParts = [];
      if (hasImage) {
        userParts.push({
          inlineData: {
            mimeType: imageMime || "image/jpeg",
            data: imageData,
          },
        });
      }
      userParts.push({
        text:
          message ||
          (hasImage ? "請描述這張圖片的內容，並用繁體中文回答。" : ""),
      });
      contents.push({ role: "user", parts: userParts });
      const payload = {
        contents,
        systemInstruction: { parts: [{ text: systemText }] },
        generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
      };
      const url =
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(model) +
        ":generateContent";
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
          (data && data.error && data.error.message) || "Gemini request failed";
        const err = new Error(msg);
        err.status = r.status;
        err.busy =
          r.status === 429 ||
          r.status === 503 ||
          /high demand|quota|unavailable|not found|no longer available|does not exist|do not have access/i.test(msg);
        throw err;
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
      return { text: text || "", model, provider: "gemini" };
    }

    const tryList = [];
    const pushUnique = (m) => {
      if (m && tryList.indexOf(m) === -1) tryList.push(m);
    };
    if (hasImage) {
      if (process.env.GEMINI_API_KEY) {
        if (!isGroqModel(preferred)) pushUnique(preferred);
        GEMINI_MODELS.forEach(pushUnique);
      }
      if (process.env.GROQ_API_KEY) {
        GROQ_VISION_MODELS.forEach(pushUnique);
      }
    } else {
      pushUnique(preferred);
      if (isGroqModel(preferred)) {
        GROQ_MODELS.forEach(pushUnique);
        if (process.env.GEMINI_API_KEY) GEMINI_MODELS.forEach(pushUnique);
      } else {
        GEMINI_MODELS.forEach(pushUnique);
        if (process.env.GROQ_API_KEY) GROQ_MODELS.forEach(pushUnique);
      }
    }

    let lastError = "AI request failed";
    for (const model of tryList) {
      try {
        const useGroq = isGroqModel(model);
        if (useGroq && !process.env.GROQ_API_KEY) continue;
        if (!useGroq && !process.env.GEMINI_API_KEY) continue;
        const result = useGroq ? await callGroq(model) : await callGemini(model);
        return res.status(200).json({
          ok: true,
          text: result.text,
          model: result.model,
          provider: result.provider,
        });
      } catch (e) {
        lastError = String((e && e.message) || e);
        if (e && e.busy) continue;
        if (/not set|does not exist|do not have access|not found|decommissioned|invalid model/i.test(lastError)) continue;
        continue;
      }
    }

    if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
      return res
        .status(500)
        .json({ ok: false, error: "請設定 GEMINI_API_KEY 或 GROQ_API_KEY" });
    }
    let zh = "目前 AI 服務暫時無法回應，請稍後再試。";
    if (/high demand|rate limit|overloaded|busy/i.test(lastError)) {
      zh = "目前 AI 服務較忙碌，請稍後再試。";
    } else if (/api.?key|not set/i.test(lastError)) {
      zh = "AI 金鑰未設定，請聯絡管理員。";
    }
    return res.status(503).json({ ok: false, error: zh });
  }

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
    return res.status(200).json({ loggedIn: false, maintenanceMode: await isMaintenanceMode() });
  }

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
