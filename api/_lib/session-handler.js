const { tryHandleStore } = require("./session-store-actions");
const { parseCookies, serializeCookie } = require("./cookies");
const { PROVIDERS, isConfigured } = require("./providers");
const { verify } = require("./jwt");
const { isAdminSession, isSuperAdminSession } = require("./admin");
const { isBetaTester } = require("./beta-testers");
const { isAdventureSkip } = require("./adventure-skip");
const { getOrCreateMemberId } = require("./member-id");
const { getUserProfile, setUserProfile } = require("./user-profile");
const { getNicknameCooldownDays, isMaintenanceMode, getAdventureDailyLimitMinutes } = require("./app-settings");
const { getUsage, startSession, endSession } = require("./adventure-usage");
const { addSubscription, removeSubscription } = require("./push-store");
const { getPublicKey } = require("./web-push");
const { addIosToken, removeIosToken } = require("./apns-store");
const {
  userKeyFromPayload,
  listChats,
  getChat,
  saveChat,
  deleteChat,
} = require("./ai-chats");
const { buildMapskyBridge } = require("./mapsky-bridge");

async function sessionHandler(req, res) {
  if (await tryHandleStore(req, res)) return;

  // AI chats cloud storage
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

  if (req.query.action === "mapsky-bridge") {
    const cookiesBr = parseCookies(req);
    if (!verify(cookiesBr.nexora_session)) {
      return res.status(401).json({ ok: false, error: "請先登入", reason: "not-authenticated" });
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

  // Default: logged-in session profile
  const isSuperAdmin = isSuperAdminSession(payload);
  const isAdmin = isAdminSession(payload) || isSuperAdmin;
  const betaTester = await isBetaTester(payload);
  const adventureSkipListed = await isAdventureSkip(payload);
  let memberId = null;
  try { memberId = await getOrCreateMemberId(payload); } catch (_) {}
  let profileExtra = null;
  try { profileExtra = await getUserProfile(payload.provider, payload.profile && payload.profile.id); } catch (_) {}

  return res.status(200).json({
    loggedIn: true,
    profile: {
      ...(payload.profile || {}),
      ...(profileExtra || {}),
    },
    provider: payload.provider || null,
    isAdmin,
    isSuperAdmin,
    memberId,
    betaTester,
    adventureSkip: isSuperAdmin || adventureSkipListed,
    maintenanceMode: await isMaintenanceMode(),
    nicknameCooldownDays: await getNicknameCooldownDays(),
    vapidPublicKey: getPublicKey(),
    updateChannelAccess: {
      publicBeta: isSuperAdmin || betaTester,
      internalBeta: isSuperAdmin,
    },
  });
}

module.exports = { sessionHandler };
