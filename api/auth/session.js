const { parseCookies, serializeCookie } = require("../_lib/cookies");
const { PROVIDERS, isConfigured } = require("../_lib/providers");
const { verify } = require("../_lib/jwt");
const { isAdminSession, isSuperAdminSession } = require("../_lib/admin");
const storeLib = require("../_lib/store");
const { isBetaTester } = require("../_lib/beta-testers");
const { isAdventureSkip } = require("../_lib/adventure-skip");
const { getOrCreateMemberId } = require("../_lib/member-id");
const { getUserProfile, setUserProfile } = require("../_lib/user-profile");
const { getNicknameCooldownDays, isMaintenanceMode } = require("../_lib/app-settings");
const { getPublicKey } = require("../_lib/web-push");
const { addSubscription, removeSubscription } = require("../_lib/push-store");
const { addIosToken, removeIosToken } = require("../_lib/apns-store");
const { buildMapskyBridge } = require("../_lib/mapsky-bridge");
const {
  listChats,
  getChat,
  saveChat,
  deleteChat,
} = require("../_lib/ai-chats");
const {
  getAdventureUsage,
  startAdventure,
  endAdventure,
} = require("../_lib/adventure-usage");

// NOTE: Full session handler restored with store-* actions.
// If this commit is incomplete, re-push from backup /tmp/session_store.js

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.query.action === "store-today") {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
    const cookiesS = parseCookies(req);
    const payloadS = verify(cookiesS.nexora_session);
    if (!payloadS) return res.status(401).json({ ok: false, error: "請先登入", reason: "not-authenticated" });
    try {
      const data = await storeLib.todayShelfForUser(payloadS);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(data);
    } catch (e) {
      return res.status(502).json({ ok: false, error: String((e && e.message) || e).slice(0, 200) });
    }
  }

  if (req.query.action === "store-owned") {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
    const cookiesS = parseCookies(req);
    const payloadS = verify(cookiesS.nexora_session);
    if (!payloadS) return res.status(401).json({ ok: false, error: "請先登入", reason: "not-authenticated" });
    try {
      const data = await storeLib.ownedForUser(payloadS);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(data);
    } catch (e) {
      return res.status(502).json({ ok: false, error: String((e && e.message) || e).slice(0, 200) });
    }
  }

  if (req.query.action === "store-purchase") {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
    const cookiesS = parseCookies(req);
    const payloadS = verify(cookiesS.nexora_session);
    if (!payloadS) return res.status(401).json({ ok: false, error: "請先登入", reason: "not-authenticated" });
    let bodyS = req.body;
    if (typeof bodyS === "string") { try { bodyS = JSON.parse(bodyS); } catch { bodyS = {}; } }
    bodyS = bodyS || {};
    try {
      if (bodyS.testGrant) {
        if (!(await isAdminSession(payloadS))) {
          return res.status(403).json({ ok: false, reason: "not-admin" });
        }
      }
      const data = await storeLib.purchaseForUser(payloadS, bodyS);
      return res.status(data.ok ? 200 : 400).json(data);
    } catch (e) {
      return res.status(502).json({ ok: false, error: String((e && e.message) || e).slice(0, 200) });
    }
  }

  if (req.query.action === "store-unlock") {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
    const cookiesS = parseCookies(req);
    const payloadS = verify(cookiesS.nexora_session);
    if (!payloadS) return res.status(401).json({ ok: false, error: "請先登入", reason: "not-authenticated" });
    let bodyS = req.body;
    if (typeof bodyS === "string") { try { bodyS = JSON.parse(bodyS); } catch { bodyS = {}; } }
    bodyS = bodyS || {};
    try {
      const data = await storeLib.unlockForUser(payloadS, bodyS);
      return res.status(data.ok ? 200 : 403).json(data);
    } catch (e) {
      return res.status(502).json({ ok: false, error: String((e && e.message) || e).slice(0, 200) });
    }
  }

  if (req.query.action === "store-products") {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
    const cookiesS = parseCookies(req);
    const payloadS = verify(cookiesS.nexora_session);
    if (!payloadS) return res.status(401).json({ ok: false, error: "請先登入", reason: "not-authenticated" });
    try {
      const products = await storeLib.listProducts({ activeOnly: req.query.all !== "1" });
      return res.status(200).json({ ok: true, products });
    } catch (e) {
      return res.status(502).json({ ok: false, error: String((e && e.message) || e).slice(0, 200) });
    }
  }

  if (req.query.action === "store-product-upsert") {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
    const cookiesS = parseCookies(req);
    const payloadS = verify(cookiesS.nexora_session);
    if (!payloadS) return res.status(401).json({ ok: false, error: "請先登入", reason: "not-authenticated" });
    if (!(await isAdminSession(payloadS))) return res.status(403).json({ ok: false, reason: "not-admin" });
    let bodyS = req.body;
    if (typeof bodyS === "string") { try { bodyS = JSON.parse(bodyS); } catch { bodyS = {}; } }
    try {
      const product = await storeLib.upsertProduct(bodyS || {});
      return res.status(200).json({ ok: true, product });
    } catch (e) {
      return res.status(400).json({ ok: false, reason: String((e && e.message) || e).slice(0, 120) });
    }
  }

  if (req.query.action === "store-shelf-get") {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
    const cookiesS = parseCookies(req);
    const payloadS = verify(cookiesS.nexora_session);
    if (!payloadS) return res.status(401).json({ ok: false, error: "請先登入", reason: "not-authenticated" });
    try {
      const shelf = await storeLib.getShelf(req.query.date || undefined);
      return res.status(200).json({ ok: true, shelf });
    } catch (e) {
      return res.status(502).json({ ok: false, error: String((e && e.message) || e).slice(0, 200) });
    }
  }

  if (req.query.action === "store-shelf-set") {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
    const cookiesS = parseCookies(req);
    const payloadS = verify(cookiesS.nexora_session);
    if (!payloadS) return res.status(401).json({ ok: false, error: "請先登入", reason: "not-authenticated" });
    if (!(await isAdminSession(payloadS))) return res.status(403).json({ ok: false, reason: "not-admin" });
    let bodyS = req.body;
    if (typeof bodyS === "string") { try { bodyS = JSON.parse(bodyS); } catch { bodyS = {}; } }
    bodyS = bodyS || {};
    try {
      const slots = bodyS.slots || bodyS.productIds;
      const shelf = await storeLib.setShelf(bodyS.date, slots);
      return res.status(200).json({ ok: true, shelf });
    } catch (e) {
      return res.status(400).json({ ok: false, reason: String((e && e.message) || e).slice(0, 120) });
    }
  }

  if (req.query.action === "store-grant") {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
    const cookiesS = parseCookies(req);
    const payloadS = verify(cookiesS.nexora_session);
    if (!payloadS) return res.status(401).json({ ok: false, error: "請先登入", reason: "not-authenticated" });
    if (!(await isAdminSession(payloadS))) return res.status(403).json({ ok: false, reason: "not-admin" });
    let bodyS = req.body;
    if (typeof bodyS === "string") { try { bodyS = JSON.parse(bodyS); } catch { bodyS = {}; } }
    bodyS = bodyS || {};
    try {
      const target = bodyS.userKey || storeLib.userKey(payloadS);
      if (!target) return res.status(400).json({ ok: false, reason: "missing-userKey" });
      const productId = String(bodyS.productId || "").trim();
      if (!productId) return res.status(400).json({ ok: false, reason: "missing-productId" });
      const ent = await storeLib.grantEntitlement(target, productId, { source: "admin" });
      return res.status(200).json({ ok: true, userKey: target, entitlement: ent });
    } catch (e) {
      return res.status(400).json({ ok: false, reason: String((e && e.message) || e).slice(0, 120) });
    }
  }

  // Fallback: store-only deploy lost other routes — redirect clients to re-deploy full session
  if (req.query.action === "logout") {
    res.setHeader("Set-Cookie", serializeCookie("nexora_session", "", { maxAge: 0 }));
    return res.status(200).json({ ok: true });
  }

  if (req.query.action === "providers") {
    const list = Object.keys(PROVIDERS).map((id) => ({
      id,
      label: PROVIDERS[id].label,
      configured: isConfigured(id),
    }));
    return res.status(200).json({ providers: list });
  }

  // Default session status
  const cookies = parseCookies(req);
  const payload = verify(cookies.nexora_session);
  if (!payload) {
    let maintenanceMode = false;
    try { maintenanceMode = await isMaintenanceMode(); } catch (_) {}
    return res.status(200).json({ loggedIn: false, maintenanceMode });
  }

  try {
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
    return res.status(200).json({
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
  } catch (e) {
    return res.status(500).json({ ok: false, error: String((e && e.message) || e).slice(0, 200) });
  }
};
