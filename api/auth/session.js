const { tryHandleStore } = require("../_lib/session-store-actions");
const { handleDevicesSync } = require("../_lib/devices-sync");

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
const { getCity, getAlerts, getLightning, getRadarComposite, CWA_CITIES } = require("../_lib/cwa");
const { buildMapskyBridge } = require("../_lib/mapsky-bridge");

function isDevicesRequest(req) {
  if (req.query && req.query.__devices === "1") return true;
  const a = req.query && req.query.action;
  return a === "list" || a === "heartbeat" || a === "remove";
}

module.exports = async function handler(req, res) {
  if (isDevicesRequest(req)) {
    return handleDevicesSync(req, res);
  }

  if (await tryHandleStore(req, res)) return;

  if (req.query.action === "ai-chats" || req.query.action === "ai-chat-get" ||
      req.query.action === "ai-chat-save" || req.query.action === "ai-chat-delete") {
    const cookies = parseCookies(req);
    const sessionPayload = verify(cookies.nexora_session);
    const uk = userKeyFromPayload(sessionPayload);
    if (!uk) {
      return res.status(401).json({ ok: false, error: "隢见��餃�隞乩蝙�券𤩅蝡臬�閰�" });
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

  if (req.query.action === "mapsky-bridge") {
    const cookiesBr = parseCookies(req);
    if (!verify(cookiesBr.nexora_session)) {
      return res.status(401).json({ ok: false, error: "隢见��餃�", reason: "not-authenticated" });
    }
    let bodyBr = req.body;
    if (typeof bodyBr === "string") {
      try { bodyBr = JSON.parse(bodyBr); } catch { bodyBr = {}; }
    }
    bodyBr = bodyBr || {};
    const qBr = req.query || {};
    try {
      const payload = await buildMapskyBridge({
        city: bodyBr.city || qBr.city || "",
        placeName: bodyBr.placeName || bodyBr.place || qBr.placeName || "",
        lat: bodyBr.lat != null ? Number(bodyBr.lat) : qBr.lat != null ? Number(qBr.lat) : null,
        lon: bodyBr.lon != null ? Number(bodyBr.lon) : qBr.lon != null ? Number(qBr.lon) : null,
        include: bodyBr.include || qBr.include || "weather,alerts,weekly",
        refresh: qBr.refresh === "1" || bodyBr.refresh === true || bodyBr.refresh === "1",
      });
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(payload);
    } catch (err) {
      return res.status(502).json({ ok: false, error: String((err && err.message) || err).slice(0, 200) });
    }
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
      return res.status(400).json({ ok: false, reason: "�𣇉�憭芸之嚗諹��貉�撠讐��抒�" });
    }

    const GEMINI_MODELS = [
      "gemini-3.8-flash",
      "gemini-3.5-flash-lite",
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash",
    ];
    const GROQ_MODELS = [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "openai/gpt-oss-120b",
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
    const envDefault = process.env.AI_DEFAULT_MODEL || process.env.GEMINI_MODEL || "gemini-3.8-flash";
    const clientModel = typeof body.model === "string" ? body.model.trim() : "";
    let preferred =
      clientModel && ALLOWED.indexOf(clientModel) !== -1 ? clientModel : envDefault;
    if (ALLOWED.indexOf(preferred) === -1) preferred = "gemini-3.8-flash";

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
      "雿删��滚��� Aether嚗峕糓 MapSky App �批遣�� AI �拇���\n" +
      "�函�擃𥪯葉�����瘞�䌊�嗉扛����譍��砍�蝘���𨭌���璅��蝑䈑�銝滩��𤾸漲�芣�隞讠晶�𤥁圾�𧢲��������\n" +
      "�臬��拇𠯫撣詨�蝑𢛵��䰻霅塩��蕃霅胯��神雿栶��App 雿輻鍂蝑剹��\n" +
      "�𣂼予瘞��MapSky�穃蘨�劐蝙�刻���坔蘂�𡒊Ⅱ�典�憭拇除���銝齿�銝钅𢂚��除皞怒����麄��換憭𣇉���２憸具��郎�孵𥼚��𡺨�娍�嚗峕�隢��憭拇除�硋��冽除鞊∟��辷�銝��祈�憭押��玨璆准��圾憿䔶�閬��憭拇除�� MapSky��\n" +
      "�鞉�撠卝�穃蘨�匧�憿峕�憿舫�閬���啣朖���閮𠺪��啗�����嫘��魚鈭讠��𦦵�嚗㗇��滢�鞈湔�撠讠��頣��桅�𡁜虜霅睃�蝑𠉛凒�亙�蝑𥪜朖�胯��\n" +
      "�噼�隞交��埈�畾菔氜�箔蜓嚗𥟇�頛�彍�𡁏��舐鍂 Markdown 銵冽聢��\n" +
      "�漤��舐鍂 ==���== �Ｗ�蝑����閬�撥隤踵��舐鍂 {#�脣�}���{#}嚗�𠧧�㵪�red orange amber yellow lime green teal cyan blue indigo purple pink rose brown gray嚗剹��\n" +
      "�砍���銁雿輻鍂���蝣箄�瘙�綫撠𠬍��寧�撘𤩺�雿輻鍂 $$...$$嚗䔶��祆彍摮𡑒��桐��冽芦�𡁏�摮堒朖�胯��\n" +
      "銝滩��典�閬�葉�𣂼�璅躰�隤墧���LaTeX���撠见極�瑟�蝟餌絞�鞟內�祈澈��";

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
        if (data.answer) lines.push("�䁅�嚗�" + data.answer);
        const results = Array.isArray(data.results) ? data.results : [];
        for (const item of results.slice(0, 5)) {
          const title = item.title || "";
          const url = item.url || "";
          const content = (item.content || "").slice(0, 280);
          lines.push("- " + title + (url ? " (" + url + ")" : "") + (content ? "嚗�" + content : ""));
        }
        if (!lines.length) return "";
        return "�𣂷誑銝讠�蝬脤��𨅯�蝯鞉�嚗諹�蝬𨅯�敺𣬚鍂蝜��銝剜��䂿�嚗��閬���舫�靘��蝬脣��髢n" + lines.join("\n");
      } catch (_) {
        return "";
      }
    }

    function looksLikeNeedSearch(text) {
      if (!text) return false;
      if (/���院�啗�|�∪�|�舐�|�穃�|瘥𠉛鸌撟ㄍ隤啗�|瘥磰魚蝯鞉�|�貉�|�𨅯�|�乩�銝𡃶蝬脰楝銝𡁷�單�/.test(text)) return true;
      if (/�圈�|憸梢◢|霅衣鸌��/.test(text)) return true;
      if (/(隞𡁷�糳敺�)憭�.*(憭拇除|�育瘞�澈|撟曉漲|蝛蹂�暻�)|�������育撣嗅�/.test(text)) return true;
      if (/憭拇除|瘞�澈|擃娍�|蝝怠�蝺𡯂�漤𢂚|�券�/.test(text)) return true;
      return false;
    }

    async function callGroq(model) {
      const key = process.env.GROQ_API_KEY;
      if (!key) throw new Error("GROQ_API_KEY not set");
      let useModel = model;
      if (hasImage && GROQ_VISION_MODELS.indexOf(model) === -1) {
        useModel = GROQ_VISION_MODELS[0];
      }
      if (hasImage) throw new Error("Groq vision model unavailable; use Gemini for images");
      const messages = [{ role: "system", content: systemText }];
      const history = Array.isArray(body.history) ? body.history : [];
      for (const h of history.slice(-20)) {
        if (!h || !h.text) continue;
        messages.push({
          role: h.role === "model" ? "assistant" : "user",
          content: String(h.text),
        });
      }
      let userText = message || (hasImage ? "隢𧢲�餈圈�坔撐�𣇉����摰對�銝衣鍂蝜��銝剜��䂿���" : "");
      if (!hasImage && looksLikeNeedSearch(userText) && process.env.TAVILY_API_KEY) {
        const snip = await webSearchTavily(userText);
        if (snip) userText = snip + "\n\n雿輻鍂���憿䕘�" + userText;
      }
      messages.push({ role: "user", content: userText });
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
        if (snip) userText = snip + "\n\n雿輻鍂���憿䕘�" + userText;
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
      let gemText = message || (hasImage ? "隢𧢲�餈圈�坔撐�𣇉����摰對�銝衣鍂蝜��銝剜��䂿���" : "");
      userParts.push({ text: gemText });
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
      const wantSearch = !hasImage && looksLikeNeedSearch(message);
      if (wantSearch) {
        try {
          return await once(true);
        } catch (e1) {
          return await once(false);
        }
      }
      return await once(false);
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
    } else {
      pushUnique(preferred);
      if (isDeepSeekModel(preferred)) {
        take(DEEPSEEK_MODELS, 2);
        if (process.env.GEMINI_API_KEY) take(GEMINI_MODELS, 2);
        if (process.env.GROQ_API_KEY) take(GROQ_MODELS, 1);
      } else if (isGroqModel(preferred)) {
        take(GROQ_MODELS, 2);
        if (process.env.GEMINI_API_KEY) take(GEMINI_MODELS, 2);
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
      return res.status(500).json({ ok: false, error: "隢贝身摰� GEMINI_API_KEY��GROQ_API_KEY �� DEEPSEEK_API_KEY" });
    }
    let zh = "�桀� AI �滚��急��⊥��墧�嚗諹�蝔滚��滩岫��";
    if (/high demand|rate limit|overloaded|busy|resource exhausted|429/i.test(lastError)) {
      zh = "�桀� AI �滚�憿滚漲撌脫遛�𤥁�敹嗵�嚗諹�蝔滚��滩岫��";
    } else if (/api.?key|not set|invalid.*key|permission|401|403/i.test(lastError)) {
      zh = "AI �煾麯�⊥��𡝗��𣂷�頞喉�隢𧢲炎�� Vercel �啣�霈𦠜彍��";
    } else if (/not found|do not have access|decommissioned|invalid model|does not exist/i.test(lastError)) {
      zh = "���豢芋�讠𤌍�滢��舐鍂嚗諹��寥��嗡�璅∪���";
    } else if (lastError && lastError !== "AI request failed") {
      zh = "AI �墧�憭望�嚗�" + lastError.slice(0, 120);
    }
    return res.status(503).json({ ok: false, error: zh, detail: lastError.slice(0, 300) });
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
    // endSession �芸� (payload, limit)嚗𥕦�擗睃��詨蕭��
    const result = await endSession(payload, limit);
    return res.status(result.ok ? 200 : 400).json(result);
  }

  // �詨捆 iOS 摰Ｘ�蝡荔�POST adventure-usage { deltaMinutes | usedMinutes }
  if (req.method === "POST" && req.query.action === "adventure-usage") {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body || {};
    const limit = await getAdventureDailyLimitMinutes();
    const delta = Number(body.deltaMinutes);
    if (Number.isFinite(delta) && delta > 0) {
      const result = await startSession(payload, delta, limit);
      const status = result.ok ? 200 : result.reason === "daily-limit" ? 403 : 400;
      return res.status(status).json({
        ...result,
        adventureUsedMinutes: result.used,
        adventureDailyLimitMinutes: result.limit,
      });
    }
    // 鞎䭾彍 delta �𣇉��亥岷嚗𡁶��毺𤌍�� active 銝血��單��啁鍂��
    const result = await endSession(payload, limit);
    return res.status(200).json({
      ...result,
      adventureUsedMinutes: result.used,
      adventureDailyLimitMinutes: result.limit,
    });
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

  const [isAdmin, memberId, custom, nicknameCooldownDays, maintenanceMode, betaTester, adventureSkipListed, adventureDailyLimitMinutes] = await Promise.all([
    isAdminSession(payload),
    getOrCreateMemberId(payload),
    getUserProfile(payload.provider, payload.profile.id),
    getNicknameCooldownDays(),
    isMaintenanceMode(),
    isBetaTester(payload),
    isAdventureSkip(payload),
    getAdventureDailyLimitMinutes(),
  ]);

  const isSuperAdmin = isSuperAdminSession(payload);
  const effectiveLimit = adventureDailyLimitMinutes; // 敺�蝱閮剖�撠穃停憭𡁜�嚗𣬚�銝漤���
  let adventureUsedMinutes = 0;
  try {
    const usage = await getUsage(payload, effectiveLimit);
    adventureUsedMinutes = usage && Number.isFinite(usage.used) ? usage.used : 0;
  } catch (_) {}

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
    adventureSkip: adventureSkipListed,
    adventureDailyLimitMinutes: effectiveLimit,
    adventureUsedMinutes,
    updateChannelAccess: {
      publicBeta: isSuperAdmin || betaTester,
      internalBeta: isSuperAdmin,
    },
  });
};
