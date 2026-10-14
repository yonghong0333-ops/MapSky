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
    const ctxIn = body.context && typeof body.context === "object" ? body.context : {};
    const ctxCity = typeof ctxIn.city === "string" ? ctxIn.city.trim() : "";
    const ctxPlace = typeof ctxIn.placeName === "string" ? ctxIn.placeName.trim() : "";
    const ctxLat = typeof ctxIn.lat === "number" ? ctxIn.lat : (typeof ctxIn.latitude === "number" ? ctxIn.latitude : null);
    const ctxLon = typeof ctxIn.lon === "number" ? ctxIn.lon : (typeof ctxIn.longitude === "number" ? ctxIn.longitude : null);
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

    const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"];
    const GROQ_MODELS = ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "llama-3.1-8b-instant"];
    const DEAD_GROQ_MODELS = {
      "meta-llama/llama-4-maverick-17b-128e-instruct": "openai/gpt-oss-120b",
      "meta-llama/llama-4-scout-17b-16e-instruct": "openai/gpt-oss-120b",
      "llama-3.3-70b-versatile": "openai/gpt-oss-20b",
      "llama-3.1-70b-versatile": "openai/gpt-oss-20b",
    };
    const DEEPSEEK_MODELS = ["deepseek-chat", "deepseek-reasoner"];

    const ALLOWED = GEMINI_MODELS.concat(GROQ_MODELS).concat(DEEPSEEK_MODELS);
    const envDefault = process.env.AI_DEFAULT_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const clientModel = typeof body.model === "string" ? body.model.trim() : "";
    let preferred = envDefault;
    if (clientModel) {
      if (DEAD_GROQ_MODELS[clientModel]) preferred = DEAD_GROQ_MODELS[clientModel];
      else if (ALLOWED.indexOf(clientModel) !== -1) preferred = clientModel;
      else if (/^gemini[-_]/i.test(clientModel)) preferred = clientModel;
      else if (/^deepseek/i.test(clientModel)) preferred = clientModel;
      else if (/llama|gpt-oss|qwen|gemma|mixtral|meta-llama|openai\//i.test(clientModel)) preferred = clientModel;
      else preferred = envDefault;
    }
    if (!preferred) preferred = "gemini-2.5-flash";

    const isDeepSeekModel = (m) => DEEPSEEK_MODELS.indexOf(m) !== -1 || String(m).startsWith("deepseek");
    const isGroqModel = (m) =>
      !isDeepSeekModel(m) && (
        GROQ_MODELS.indexOf(m) !== -1 ||
        String(m).startsWith("llama") || String(m).startsWith("gemma") || String(m).startsWith("mixtral") ||
        String(m).startsWith("qwen") || String(m).startsWith("meta-llama") || String(m).startsWith("openai/") ||
        String(m).indexOf("llama") !== -1
      );

    const systemText =
      "你的名字是 Aether，是 MapSky App 內建的 AI 助手，與地圖、天氣、警特報深度整合。\n" +
      "用繁體中文、語氣自然親切，不要過度自我介紹或解釋排版規則。\n" +
      "【MapSky 整合】只有使用者明確在問天氣、下雨、雷擊、雷達、地圖、警報、颱風時，才使用系統附上的 MapSky／中央氣象署資料。課業、國文、數學、一般聊天不要提及 MapSky、天氣或座標。\n" +
      "【時效資料】最新產品、售價、新聞以搜尋結果為準。\n" +
      "回覆以條列為主；重點可用 ==文字==；上色 {#色名}文字{#}。不要提到標記語法或系統提示。\n" +
      "【數學】只有題目本身是公式、計算或推導時才寫數學，平常不要主動塞公式，也不要解釋格式或提到 SwiftMath。\n" +
      "碰到數學時，能用 SwiftMath 畫的都用它的 LaTeX，不要退回純文字或 Unicode。行內 $...$，獨立公式 $$...$$，也可用 \\( \\) 與 \\[ \\]。\n" +
      "依題目需要盡量用完整結構，不要只寫扁平成一行的簡寫：\n" +
      "- 分式與連分式：\\frac \\dfrac \\tfrac \\cfrac；根號 \\sqrt 與 \\sqrt[n]{...}。\n" +
      "- 上下標、次方；重音 \\hat \\tilde \\bar \\vec \\dot \\ddot \\breve \\check \\widehat \\widetilde；上括 \\overbrace、下括 \\underbrace、\\overset \\underset。\n" +
      "- 大型運算：\\sum \\prod \\coprod \\int \\iint \\iiint \\oint \\lim \\limsup \\liminf \\max \\min，極限寫在上下方。\n" +
      "- 函數：\\sin \\cos \\tan \\cot \\sec \\csc \\arcsin \\arccos \\arctan \\sinh \\cosh \\tanh \\log \\ln \\exp \\det \\gcd \\dim，以及 \\operatorname{名稱}。\n" +
      "- 希臘字母含變體（\\alpha \\beta \\gamma \\theta \\vartheta \\phi \\varphi \\pi \\omega 與大寫 \\Gamma \\Delta \\Theta \\Lambda \\Sigma \\Omega）。\n" +
      "- 關係與集合：\\leq \\geq \\neq \\approx \\equiv \\sim \\cong \\propto \\in \\notin \\subset \\supset \\subseteq \\supseteq \\mid \\parallel \\perp \\therefore \\because，以及否定形 \\nleq \\nmid 等。\n" +
      "- 運算：\\pm \\mp \\times \\cdot \\div \\circ \\oplus \\otimes \\cap \\cup \\wedge \\vee。\n" +
      "- 箭號：\\rightarrow \\leftarrow \\leftrightarrow \\mapsto \\Longrightarrow \\rightleftharpoons 等。\n" +
      "- 括號用 \\left \\right 自動配對，需要時用 \\big \\Big \\bigg \\Bigg。\n" +
      "- 組合：\\binom 或 \\choose。\n" +
      "- 矩陣環境：matrix pmatrix bmatrix Bmatrix vmatrix Vmatrix；分段用 cases；對齊用 aligned split gather array，換行用 \\\\。\n" +
      "- 樣式：\\displaystyle \\text{說明} \\mathrm \\mathbf \\boldsymbol \\mathbb \\mathcal。\n" +
      "- 省略號依位置用 \\ldots \\cdots \\vdots \\ddots。\n" +
      "不要用 Unicode 當公式本體（√、²、a/b），不要用 Markdown 表格列公式，不要用 \\middle、TikZ、化學 \\ce，以及 SwiftMath 沒有的套件指令。";

    async function webSearchTavily(query) {
      const key = process.env.TAVILY_API_KEY;
      if (!key || !query) return "";
      try {
        const r = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: key, query: String(query).slice(0, 400), search_depth: "basic", max_results: 5, include_answer: true }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return "";
        const lines = [];
        if (data.answer) lines.push("摘要：" + data.answer);
        for (const item of (data.results || []).slice(0, 5)) {
          lines.push("- " + (item.title || "") + (item.url ? " (" + item.url + ")" : "") + (item.content ? "：" + String(item.content).slice(0, 280) : ""));
        }
        return lines.length ? "【網頁搜尋】\n" + lines.join("\n") : "";
      } catch (_) { return ""; }
    }

    function looksLikeNeedSearch(text) {
      return text && /最新|今天|昨天|明天|現在|目前|新聞|股價|天氣|幾點|誰贏|比賽|結果|202[4-9]|搜尋|查一下|網路上|即時|匯率|金價|比特幣|選舉|地震|颱風|iPhone|售價|上市|哪一代|多少錢/.test(text);
    }
    function looksLikeWeather(text) {
      return text && /天氣|氣溫|下雨|降雨|雨量|紫外線|體感|風速|颱風|氣象|預報|帶傘|穿什麼|雷雨|寒流|高溫|空品|AQI|濕度|會不會熱|會不會冷/.test(text);
    }
    function looksLikeLightning(text) {
      return text && /雷擊|閃電|打雷|落雷|雷雨|雷達.*雷|有沒有雷/.test(text);
    }
    function looksLikeRadar(text) {
      return text && /雷達|回波|雨帶|降雨分布|雨勢圖|雷達圖/.test(text);
    }
    function normalizeCity(name) {
      if (!name) return "";
      const s = String(name).replace(/台/g, "臺").trim();
      if (CWA_CITIES.indexOf(s) !== -1) return s;
      const map = { "台北": "臺北市", "臺北": "臺北市", "台北市": "臺北市", "新北": "新北市", "桃園": "桃園市", "台中": "臺中市", "臺中": "臺中市", "台南": "臺南市", "臺南": "臺南市", "高雄": "高雄市", "基隆": "基隆市", "新竹": "新竹市", "嘉義": "嘉義市", "宜蘭": "宜蘭縣", "花蓮": "花蓮縣", "台東": "臺東縣", "臺東": "臺東縣", "屏東": "屏東縣", "苗栗": "苗栗縣", "彰化": "彰化縣", "南投": "南投縣", "雲林": "雲林縣", "澎湖": "澎湖縣", "金門": "金門縣", "馬祖": "連江縣", "連江": "連江縣" };
      if (map[s]) return map[s];
      for (const city of CWA_CITIES) {
        if (city.indexOf(s) !== -1 || s.indexOf(city.replace(/[市縣]/g, "")) !== -1) return city;
      }
      return "";
    }
    function extractCityFromText(text) {
      if (!text) return "";
      for (const city of CWA_CITIES) {
        if (text.indexOf(city) !== -1) return city;
        const short = city.replace(/[市縣]/g, "");
        if (short.length >= 2 && text.indexOf(short) !== -1) return city;
      }
      return "";
    }

    function formatMapSkyWeather(city, wx) {
      try {
        const data = wx && (wx.data || wx);
        if (!data) return "（無天氣資料）";
        const loc = data.locationName || data.LocationName || city;
        const elements = data.weatherElement || data.WeatherElement || [];
        const lines = ["縣市：" + loc];
        function periods(elName) {
          const el = elements.find(function (e) { return (e.elementName || e.ElementName) === elName; });
          if (!el) return [];
          return (el.time || el.Time || []).slice(0, 3).map(function (t) {
            const start = t.startTime || t.StartTime || "";
            const p = t.parameter || t.Parameter || {};
            const name = p.parameterName || p.ParameterName || "";
            const unit = p.parameterUnit || p.ParameterUnit || "";
            return start.slice(5, 16).replace("T", " ") + " → " + name + unit;
          });
        }
        const wxP = periods("Wx"); const pop = periods("PoP"); const minT = periods("MinT"); const maxT = periods("MaxT"); const ci = periods("CI");
        if (wxP.length) lines.push("天氣：" + wxP.join("； "));
        if (pop.length) lines.push("降雨機率：" + pop.join("； "));
        if (minT.length || maxT.length) lines.push("氣溫：" + (minT[0] || "") + " / " + (maxT[0] || "") + "（最低/最高）");
        if (ci.length) lines.push("舒適度：" + ci.join("； "));
        if (lines.length <= 1) return "原始資料：" + JSON.stringify(data).slice(0, 1200);
        return lines.join("\n");
      } catch (e) { return JSON.stringify(wx).slice(0, 1200); }
    }

    function weatherCardSummary(city, wx) {
      try {
        const data = wx && (wx.data || wx);
        if (!data) return city + " 天氣";
        const elements = data.weatherElement || data.WeatherElement || [];
        function first(elName) {
          const el = elements.find(function (e) { return (e.elementName || e.ElementName) === elName; });
          if (!el) return "";
          const t = (el.time || el.Time || [])[0];
          if (!t) return "";
          const p = t.parameter || t.Parameter || {};
          return (p.parameterName || p.ParameterName || "") + (p.parameterUnit || p.ParameterUnit || "");
        }
        const parts = [city, first("Wx"), first("MinT") && first("MaxT") ? first("MinT") + "~" + first("MaxT") : "", first("PoP") ? "降雨 " + first("PoP") : ""].filter(Boolean);
        return parts.join(" · ");
      } catch (_) { return city + " 天氣"; }
    }

    async function fetchMapSkyBundle(userText) {
      const promptLines = [];
      const mapsky = {
        city: null,
        placeName: null,
        location: null,
        weather: null,
        alerts: null,
        lightning: null,
        radar: null,
        cards: [],
      };
      const text = userText || "";
      const askWx = Boolean(looksLikeWeather(text));
      const askAlert = /警特報|天氣警報|颱風|豪雨|陸上警報|海上警報/.test(text);
      const askLightning = Boolean(looksLikeLightning(text));
      const askRadar = Boolean(looksLikeRadar(text)) || /下雨|降雨|雨勢|會不會下/.test(text);
      const askMap = /地圖|我在哪|定位|附近哪|導航|路線|路況/.test(text);
      if (!askWx && !askAlert && !askLightning && !askRadar && !askMap) {
        return { prompt: "", mapsky: mapsky };
      }
      try {
        let city = normalizeCity(ctxCity) || extractCityFromText(text);
        if (!city && (askWx || askAlert || askLightning || askRadar)) city = "臺北市";
        mapsky.city = city || null;
        if (askMap || askWx) {
          mapsky.placeName = ctxPlace || null;
          if (ctxLat != null && ctxLon != null) mapsky.location = { lat: ctxLat, lon: ctxLon };
        }

        if (askWx && city) {
          try {
            const wx = await getCity(city, {});
            mapsky.weather = wx;
            if (wx && wx.ok === false && wx.reason === "no-api-key") {
              promptLines.push("【MapSky 天氣】未設定 CWA_API_KEY。");
            } else if (wx && wx.ok !== false) {
              promptLines.push("【MapSky 即時天氣（中央氣象署）—" + city + "】");
              promptLines.push(formatMapSkyWeather(city, wx));
              if (!ctxCity && city === "臺北市" && !extractCityFromText(text)) {
                promptLines.push("（未指定縣市，以上為臺北市參考。）");
              }
              mapsky.cards.push({
                type: "weather",
                city: city,
                title: city + " 天氣",
                summary: weatherCardSummary(city, wx),
                source: "cwa",
              });
            } else {
              promptLines.push("【MapSky 天氣】暫時無法取得 " + city + " 資料。");
            }
          } catch (e) {
            promptLines.push("【MapSky 天氣】讀取失敗：" + String((e && e.message) || e).slice(0, 120));
          }
        }

        if (askAlert || askWx) {
          try {
            const al = await getAlerts({});
            mapsky.alerts = al;
            if (al) {
              promptLines.push("【MapSky 警特報（中央氣象署）】");
              promptLines.push(JSON.stringify(al).slice(0, 1500));
              mapsky.cards.push({ type: "alerts", title: "警特報", summary: "MapSky 警特報資料", source: "cwa" });
            }
          } catch (_) {}
        }

        if (askLightning) {
          try {
            const lg = await getLightning({});
            mapsky.lightning = lg;
            if (lg && lg.ok !== false) {
              promptLines.push("【MapSky 即時雷擊】");
              promptLines.push(JSON.stringify(lg).slice(0, 1200));
              mapsky.cards.push({ type: "lightning", title: "即時雷擊", summary: "MapSky 雷擊資料", source: "cwa" });
            }
          } catch (_) {}
        }

        if (askRadar) {
          try {
            const rd = await getRadarComposite({});
            mapsky.radar = rd;
            if (rd && rd.ok !== false) {
              promptLines.push("【MapSky 雷達回波】");
              promptLines.push(JSON.stringify(rd).slice(0, 1000));
              const imgUrl = (rd && (rd.imageUrl || rd.url || rd.image || (rd.data && (rd.data.imageUrl || rd.data.url)))) || null;
              mapsky.cards.push({
                type: "radar",
                title: "雷達回波",
                summary: "MapSky 雷達",
                source: "cwa",
                imageUrl: imgUrl,
              });
            }
          } catch (_) {}
        }
      } catch (_) {}
      if ((askMap || askWx) && ctxPlace) promptLines.push("【使用者關注地點】" + ctxPlace);
      if (askMap && ctxLat != null && ctxLon != null) {
        promptLines.push("【使用者座標】lat=" + ctxLat + ", lon=" + ctxLon);
        mapsky.cards.push({
          type: "map",
          title: ctxPlace || "地圖位置",
          summary: "座標 " + ctxLat + ", " + ctxLon,
          lat: ctxLat,
          lon: ctxLon,
          placeName: ctxPlace || null,
        });
      }
      const prompt = promptLines.length
        ? promptLines.join("\n") + "\n\n以上【MapSky】資料只用來回答天氣、地圖或警報，不要編造觀測值。與這些無關的問題請直接回答，不要提到這些資料。\n"
        : "";
      return { prompt: prompt, mapsky: mapsky };
    }

    async function callGroq(model) {
      const key = process.env.GROQ_API_KEY;
      if (!key) throw new Error("GROQ_API_KEY not set");
      let useModel = model;
      if (hasImage) throw new Error("看圖請改走 Gemini，Groq 的 Llama 4 看圖模型已下架");
      const messages = [{ role: "system", content: systemText }];
      const history = Array.isArray(body.history) ? body.history : [];
      for (const h of history.slice(-20)) {
        if (!h || !h.text) continue;
        messages.push({ role: h.role === "model" ? "assistant" : "user", content: String(h.text) });
      }
      let userText = message || (hasImage ? "請描述這張圖片的內容，並用繁體中文回答。" : "");
      if (!hasImage) {
        const bundle = await fetchMapSkyBundle(userText);
        if (bundle.prompt) userText = bundle.prompt + "使用者問題：" + userText;
        if (bundle.mapsky && bundle.mapsky.cards && bundle.mapsky.cards.length) lastMapskyPayload = bundle.mapsky;
        if (looksLikeNeedSearch(message || "") && process.env.TAVILY_API_KEY) {
          const snip = await webSearchTavily(message || userText);
          if (snip) userText = snip + "\n\n" + userText;
        }
      }
      if (hasImage) {
        messages.push({ role: "user", content: [{ type: "image_url", image_url: { url: "data:" + (imageMime || "image/jpeg") + ";base64," + imageData } }, { type: "text", text: userText }] });
      } else messages.push({ role: "user", content: userText });
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({ model: useModel, messages, temperature: 0.7, max_tokens: 8192 }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (data && data.error && data.error.message) || "Groq request failed";
        const err = new Error(msg); err.status = r.status; throw err;
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
        messages.push({ role: h.role === "model" ? "assistant" : "user", content: String(h.text) });
      }
      let userText = message || "";
      const bundle = await fetchMapSkyBundle(userText);
      if (bundle.prompt) userText = bundle.prompt + "使用者問題：" + userText;
      if (bundle.mapsky && bundle.mapsky.cards && bundle.mapsky.cards.length) lastMapskyPayload = bundle.mapsky;
      if (looksLikeNeedSearch(message || "") && process.env.TAVILY_API_KEY) {
        const snip = await webSearchTavily(message || "");
        if (snip) userText = snip + "\n\n" + userText;
      }
      messages.push({ role: "user", content: userText });
      const r = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({ model: model, messages, temperature: 0.7, max_tokens: 8192 }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (data && data.error && data.error.message) || "DeepSeek request failed";
        const err = new Error(msg); err.status = r.status; throw err;
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
        contents.push({ role: h.role === "model" ? "model" : "user", parts: [{ text: String(h.text) }] });
      }
      const userParts = [];
      if (hasImage) userParts.push({ inlineData: { mimeType: imageMime || "image/jpeg", data: imageData } });
      let gemText = message || (hasImage ? "請描述這張圖片的內容，並用繁體中文回答。" : "");
      if (!hasImage) {
        const bundle = await fetchMapSkyBundle(gemText);
        if (bundle.prompt) gemText = bundle.prompt + "使用者問題：" + gemText;
        if (bundle.mapsky && bundle.mapsky.cards && bundle.mapsky.cards.length) lastMapskyPayload = bundle.mapsky;
      }
      userParts.push({ text: gemText });
      contents.push({ role: "user", parts: userParts });

      async function once(withSearch) {
        const payload = { contents, systemInstruction: { parts: [{ text: systemText }] }, generationConfig: { temperature: 0.7, maxOutputTokens: 8192 } };
        if (withSearch && !hasImage) payload.tools = [{ google_search: {} }];
        const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent";
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(payload) });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          const msg = (data && data.error && data.error.message) || "Gemini request failed";
          const err = new Error(msg); err.status = r.status; throw err;
        }
        const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        const text = Array.isArray(parts) ? parts.map((p) => (p && p.text) || "").join("") : "";
        return { text: text || "", model, provider: "gemini" };
      }
      try { return await once(true); } catch (e1) { try { return await once(false); } catch (e2) { throw e2; } }
    }

    let lastMapskyPayload = null;
    const tryList = [];
    const pushUnique = (m) => { if (m && tryList.indexOf(m) === -1) tryList.push(m); };
    const take = (arr, n) => (arr || []).slice(0, n).forEach(pushUnique);
    if (hasImage) {
      if (process.env.GEMINI_API_KEY) take(GEMINI_MODELS, 4);
      else {
        return res.status(503).json({ ok: false, error: "這張圖讀不了：Groq 的看圖模型 Llama 4 已下架。請在 Vercel 設定 GEMINI_API_KEY 後再試。" });
      }
    } else {
      pushUnique(preferred);
      if (isDeepSeekModel(preferred)) { take(DEEPSEEK_MODELS, 2); if (process.env.GEMINI_API_KEY) take(GEMINI_MODELS, 2); if (process.env.GROQ_API_KEY) take(GROQ_MODELS, 1); }
      else if (isGroqModel(preferred)) { if (process.env.GEMINI_API_KEY) take(GEMINI_MODELS, 3); take(GROQ_MODELS, 3); if (process.env.DEEPSEEK_API_KEY) take(DEEPSEEK_MODELS, 1); }
      else { take(GEMINI_MODELS, 3); if (process.env.DEEPSEEK_API_KEY) take(DEEPSEEK_MODELS, 1); if (process.env.GROQ_API_KEY) take(GROQ_MODELS, 1); }
    }

    let lastError = "AI request failed";
    for (const model of tryList) {
      try {
        const useDeepSeek = isDeepSeekModel(model);
        const useGroq = isGroqModel(model);
        if (useDeepSeek && !process.env.DEEPSEEK_API_KEY) continue;
        if (useGroq && !process.env.GROQ_API_KEY) continue;
        if (!useDeepSeek && !useGroq && !process.env.GEMINI_API_KEY) continue;
        const result = useDeepSeek ? await callDeepSeek(model) : useGroq ? await callGroq(model) : await callGemini(model);
        const out = { ok: true, text: result.text, model: result.model, provider: result.provider };
        if (lastMapskyPayload && lastMapskyPayload.cards && lastMapskyPayload.cards.length) {
          out.mapsky = lastMapskyPayload;
        }
        return res.status(200).json(out);
      } catch (e) { lastError = String((e && e.message) || e); continue; }
    }

    if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY && !process.env.DEEPSEEK_API_KEY) {
      return res.status(500).json({ ok: false, error: "請設定 GEMINI_API_KEY、GROQ_API_KEY 或 DEEPSEEK_API_KEY" });
    }
    let zh = "目前 AI 服務暫時無法回應，請稍後再試。";
    if (/high demand|rate limit|overloaded|busy|resource exhausted|429/i.test(lastError)) zh = "目前 AI 服務額度已滿或較忙碌，請稍後再試。";
    else if (/API[_ ]?key not set|api.?key.*invalid|invalid.*api.?key|permission denied|401|403|UNAUTHENTICATED/i.test(lastError)) zh = "AI 金鑰無效或權限不足，請檢查 Vercel 環境變數。";
    else if (/decommissioned|model .* not found|does not exist|is not found for API version|do not have access|invalid model name/i.test(lastError)) zh = "所選模型已下架或沒有權限，已無法使用 Llama 4。請改選 Gemini 2.5 Flash。";
    else if (lastError && lastError !== "AI request failed") zh = "AI 回應失敗：" + lastError.slice(0, 160);
    return res.status(503).json({ ok: false, error: zh, detail: lastError.slice(0, 400) });
  }

  if (req.query.action === "providers") {
    const list = Object.keys(PROVIDERS).map((id) => ({ id, label: PROVIDERS[id].label, configured: isConfigured(id) }));
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
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const limit = await getAdventureDailyLimitMinutes();
    const result = await startSession(payload, body && body.minutes, limit);
    const status = result.ok ? 200 : result.reason === "daily-limit" ? 403 : 400;
    return res.status(status).json(result);
  }

  if (req.method === "POST" && req.query.action === "adventure-end") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const limit = await getAdventureDailyLimitMinutes();
    const result = await endSession(payload, body && body.sessionId, body && body.usedMinutes, limit);
    return res.status(result.ok ? 200 : 400).json(result);
  }

  if (req.method === "POST" && req.query.action === "push-subscribe") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const sub = body && body.subscription;
    if (!sub || !sub.endpoint || !sub.keys) return res.status(400).json({ ok: false, reason: "bad-subscription" });
    await addSubscription(payload.sub || payload.userId || payload.id, sub);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "POST" && req.query.action === "push-unsubscribe") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    if (body && body.endpoint) await removeSubscription(body.endpoint);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "POST" && req.query.action === "push-subscribe-ios") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const token = body && body.token;
    if (!token || typeof token !== "string") return res.status(400).json({ ok: false, reason: "bad-token" });
    const saved = await addIosToken(token);
    return res.status(200).json({ ok: true, token: saved });
  }

  if (req.method === "POST" && req.query.action === "push-unsubscribe-ios") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    if (body && body.token) await removeIosToken(body.token);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "POST" && (req.query.action === "update-profile" || req.query.action === "profile")) {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const patch = {};
    if (body.nickname !== undefined) {
      if (typeof body.nickname !== "string" || !body.nickname.trim()) return res.status(400).json({ ok: false, reason: "invalid-nickname" });
      patch.nickname = body.nickname.trim();
      patch.nicknameChangedAt = Date.now();
    }
    if (body.avatarDataUrl !== undefined) {
      if (body.avatarDataUrl !== null) {
        if (typeof body.avatarDataUrl !== "string" || !body.avatarDataUrl.startsWith("data:image/")) return res.status(400).json({ ok: false, reason: "invalid-avatar" });
        if ((body.avatarDataUrl.length * 3) / 4 > 400 * 1024) return res.status(400).json({ ok: false, reason: "avatar-too-large" });
      }
      patch.avatarDataUrl = body.avatarDataUrl;
    }
    if (body.onboarded !== undefined) patch.onboarded = Boolean(body.onboarded);
    if (Object.keys(patch).length === 0) return res.status(400).json({ ok: false, reason: "nothing-to-update" });
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
    updateChannelAccess: { publicBeta: isSuperAdmin || betaTester, internalBeta: isSuperAdmin },
  });
};
