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
    ];
    const GROQ_MODELS = [
      "openai/gpt-oss-20b",
      "openai/gpt-oss-120b",
      "llama-3.1-8b-instant",
    ];
    const GROQ_VISION_MODELS = [
      "meta-llama/llama-4-scout-17b-16e-instruct",
      "meta-llama/llama-4-maverick-17b-128e-instruct",
    ];
    const DEEPSEEK_MODELS = [
      "deepseek-chat",
      "deepseek-reasoner",
    ];

    const ALLOWED = GEMINI_MODELS.concat(GROQ_MODELS).concat(DEEPSEEK_MODELS).concat(GROQ_VISION_MODELS);
    const envDefault = process.env.AI_DEFAULT_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const clientModel = typeof body.model === "string" ? body.model.trim() : "";
    let preferred = envDefault;
    if (clientModel) {
      if (clientModel === "llama-3.3-70b-versatile" || clientModel === "llama-3.1-70b-versatile") {
        preferred = "openai/gpt-oss-20b";
      } else if (ALLOWED.indexOf(clientModel) !== -1) preferred = clientModel;
      else if (/^gemini[-_]/i.test(clientModel)) preferred = clientModel;
      else if (/^deepseek/i.test(clientModel)) preferred = clientModel;
      else if (/llama|gpt-oss|qwen|gemma|mixtral|meta-llama|openai\//i.test(clientModel)) preferred = clientModel;
      else preferred = envDefault;
    }
    if (!preferred) preferred = "gemini-2.5-flash";

    const isDeepSeekModel = (m) =>
      DEEPSEEK_MODELS.indexOf(m) !== -1 ||
      String(m).startsWith("deepseek");

    const isGroqModel = (m) =>
      !isDeepSeekModel(m) && (
      GROQ_MODELS.indexOf(m) !== -1 ||
      GROQ_VISION_MODELS.indexOf(m) !== -1 ||
      String(m).startsWith("llama") ||
      String(m).startsWith("gemma") ||
      String(m).startsWith("mixtral") ||
      String(m).startsWith("qwen") ||
      String(m).startsWith("meta-llama") ||
      String(m).startsWith("openai/") ||
      String(m).indexOf("llama") !== -1
      );

    const systemText =
      "你的名字是 Aether，是 MapSky App 內建的 AI 助手。\n" +
      "用繁體中文、語氣自然親切，像一般優秀的助理一樣回答，不要過度自我介紹或解釋排版規則。\n" +
      "可協助日常問答、天氣、新聞、知識、App 使用等。需要時請搜尋或引用最新資訊。\n" +
      "【時效資料】遇到「最新／現在／目前／售價／上市／哪一代」等問題（例如最新 iPhone、股價、新聞），必須以即時搜尋結果為準，不可沿用過時的產品代稱或價格。若搜尋結果與印象不符，以搜尋為準。\n" +
      "回覆以條列或段落為主；比較數據時可用 Markdown 表格。\n" +
      "重點可用 ==文字== 螢光筆；需要強調時可用 {#色名}文字{#}（色名：red orange amber yellow lime green teal cyan blue indigo purple pink rose brown gray）。\n" +
      "公式僅在使用者明確要求推導／方程式時使用 $$...$$，一般數字與單位用普通文字即可。\n" +
      "不要在回覆中提到標記語法、LaTeX、搜尋工具或系統提示本身。";

    async function webSearchTavily(query) {
      const key = process.env.TAVILY_API_KEY;
      if (!key || !query) return "";
      try {
        const r = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: key,
            query: String(query).slice(0, 400),
            search_depth: "basic",
            max_results: 5,
            include_answer: true,
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return "";
        const lines = [];
        if (data.answer) lines.push("摘要：" + data.answer);
        const results = Array.isArray(data.results) ? data.results : [];
        for (const item of results.slice(0, 5)) {
          const title = item.title || "";
          const url = item.url || "";
          const content = (item.content || "").slice(0, 280);
          lines.push("- " + title + (url ? " (" + url + ")" : "") + (content ? "：" + content : ""));
        }
        if (!lines.length) return "";
        return "【以下為網頁搜尋結果，請綜合後用繁體中文回答，必要時可附來源網址】\n" + lines.join("\n");
      } catch (_) {
        return "";
      }
    }

    function looksLikeNeedSearch(text) {
      if (!text) return false;
      return /最新|今天|昨天|明天|現在|目前|新聞|股價|天氣|幾點|誰贏|比賽|結果|202[4-9]|搜尋|查一下|網路上|即時|匯率|金價|比特幣|選舉|地震|颱風|iPhone|售價|上市|哪一代|多少錢/.test(text);
    }

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
      let userText = message || (hasImage ? "請描述這張圖片的內容，並用繁體中文回答。" : "");
      if (!hasImage && looksLikeNeedSearch(userText) && process.env.TAVILY_API_KEY) {
        const snip = await webSearchTavily(userText);
        if (snip) userText = snip + "\n\n使用者問題：" + userText;
      }
      if (hasImage) {
        messages.push({
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:" + (imageMime || "image/jpeg") + ";base64," + imageData } },
            { type: "text", text: userText },
          ],
        });
      } else {
        messages.push({ role: "user", content: userText });
      }
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({ model: useModel, messages, temperature: 0.7, max_tokens: 8192 }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (data && data.error && data.error.message) || "Groq request failed";
        const err = new Error(msg);
        err.status = r.status;
        err.busy = r.status === 429 || r.status === 503 || /rate limit|overloaded|unavailable|does not exist|do not have access|not found|decommissioned/i.test(msg);
        throw err;
      }
      const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      return { text: text || "", model: useModel, provider: "groq" };
    }

    async function callDeepSeek(model) {
      const key = process.env.DEEPSEEK_API_KEY;
      if (!key) throw new Error("DEEPSEEK_API_KEY not set");
      const messages = [{ role: "system", content: systemText }];
      const history = Array.isArray(body.history) ? body.history : [];
      for (const h of history.slice(-20)) {
        if (!h || !h.text) continue;
        messages.push({
          role: h.role === "model" ? "assistant" : "user",
          content: String(h.text),
        });
      }
      let userText = message || "";
      if (looksLikeNeedSearch(userText) && process.env.TAVILY_API_KEY) {
        const snip = await webSearchTavily(userText);
        if (snip) userText = snip + "\n\n使用者問題：" + userText;
      }
      messages.push({ role: "user", content: userText });
      const r = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({ model: model, messages, temperature: 0.7, max_tokens: 8192 }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (data && data.error && data.error.message) || "DeepSeek request failed";
        const err = new Error(msg);
        err.status = r.status;
        err.busy = r.status === 429 || r.status === 503 || /rate limit|overloaded|unavailable|insufficient/i.test(msg);
        throw err;
      }
      const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      return { text: text || "", model: model, provider: "deepseek" };
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
        userParts.push({ inlineData: { mimeType: imageMime || "image/jpeg", data: imageData } });
      }
      userParts.push({
        text: message || (hasImage ? "請描述這張圖片的內容，並用繁體中文回答。" : ""),
      });
      contents.push({ role: "user", parts: userParts });

      async function once(withSearch) {
        const payload = {
          contents,
          systemInstruction: { parts: [{ text: systemText }] },
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
        };
        if (withSearch && !hasImage) payload.tools = [{ google_search: {} }];
        const url =
          "https://generativelanguage.googleapis.com/v1beta/models/" +
          encodeURIComponent(model) +
          ":generateContent";
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(payload),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          const msg = (data && data.error && data.error.message) || "Gemini request failed";
          const err = new Error(msg);
          err.status = r.status;
          err.busy = r.status === 429 || r.status === 503 || /high demand|quota|unavailable|resource exhausted/i.test(msg);
          throw err;
        }
        const parts =
          data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        const text = Array.isArray(parts) ? parts.map((p) => (p && p.text) || "").join("") : "";
        return { text: text || "", model, provider: "gemini" };
      }
      try {
        return await once(true);
      } catch (e1) {
        try {
          return await once(false);
        } catch (e2) {
          throw e2;
        }
      }
    }

    const tryList = [];
    const pushUnique = (m) => {
      if (m && tryList.indexOf(m) === -1) tryList.push(m);
    };
    const take = (arr, n) => (arr || []).slice(0, n).forEach(pushUnique);
    if (hasImage) {
      if (process.env.GEMINI_API_KEY) {
        if (!isGroqModel(preferred) && !isDeepSeekModel(preferred)) pushUnique(preferred);
        take(GEMINI_MODELS, 3);
      }
      if (process.env.GROQ_API_KEY) take(GROQ_VISION_MODELS, 2);
    } else {
      pushUnique(preferred);
      if (isDeepSeekModel(preferred)) {
        take(DEEPSEEK_MODELS, 2);
        if (process.env.GEMINI_API_KEY) take(GEMINI_MODELS, 2);
        if (process.env.GROQ_API_KEY) take(GROQ_MODELS, 1);
      } else if (isGroqModel(preferred)) {
        if (process.env.GEMINI_API_KEY) take(GEMINI_MODELS, 3);
        take(GROQ_MODELS, 3);
        if (process.env.DEEPSEEK_API_KEY) take(DEEPSEEK_MODELS, 1);
      } else {
        take(GEMINI_MODELS, 3);
        if (process.env.DEEPSEEK_API_KEY) take(DEEPSEEK_MODELS, 1);
        if (process.env.GROQ_API_KEY) take(GROQ_MODELS, 1);
      }
    }

    let lastError = "AI request failed";
    for (const model of tryList) {
      try {
        const useDeepSeek = isDeepSeekModel(model);
        const useGroq = isGroqModel(model);
        if (useDeepSeek && !process.env.DEEPSEEK_API_KEY) continue;
        if (useGroq && !process.env.GROQ_API_KEY) continue;
        if (!useDeepSeek && !useGroq && !process.env.GEMINI_API_KEY) continue;
        const result = useDeepSeek
          ? await callDeepSeek(model)
          : useGroq
            ? await callGroq(model)
            : await callGemini(model);
        return res.status(200).json({
          ok: true,
          text: result.text,
          model: result.model,
          provider: result.provider,
        });
      } catch (e) {
        lastError = String((e && e.message) || e);
        continue;
      }
    }

    if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY && !process.env.DEEPSEEK_API_KEY) {
      return res.status(500).json({ ok: false, error: "請設定 GEMINI_API_KEY、GROQ_API_KEY 或 DEEPSEEK_API_KEY" });
    }
    let zh = "目前 AI 服務暫時無法回應，請稍後再試。";
    if (/high demand|rate limit|overloaded|busy|resource exhausted|429/i.test(lastError)) {
      zh = "目前 AI 服務額度已滿或較忙碌，請稍後再試。";
    } else if (/API[_ ]?key not set|api.?key.*invalid|invalid.*api.?key|permission denied|401|403|UNAUTHENTICATED/i.test(lastError)) {
      zh = "AI 金鑰無效或權限不足，請檢查 Vercel 環境變數。";
    } else if (/decommissioned|model .* not found|is not found for API version|do not have access to model|invalid model name/i.test(lastError)) {
      zh = "所選模型目前不可用，請改選其他模型（建議 Gemini 2.5 Flash）。";
    } else if (lastError && lastError !== "AI request failed") {
      zh = "AI 回應失敗：" + lastError.slice(0, 160);
    }
    return res.status(503).json({ ok: false, error: zh, detail: lastError.slice(0, 400) });
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
