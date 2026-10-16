const { tryHandleStore } = require("../_lib/session-store-actions");

module.exports = async function handler(req, res) {
  if (await tryHandleStore(req, res)) return;

  try {
    const full = require("../_lib/session-full");
    return full(req, res);
  } catch (e) {
    const { parseCookies, serializeCookie } = require("../_lib/cookies");
    const { PROVIDERS, isConfigured } = require("../_lib/providers");
    const { verify } = require("../_lib/jwt");
    const { isAdminSession, isSuperAdminSession } = require("../_lib/admin");
    const { isBetaTester } = require("../_lib/beta-testers");
    const { isAdventureSkip } = require("../_lib/adventure-skip");
    const { getOrCreateMemberId } = require("../_lib/member-id");
    const { getUserProfile } = require("../_lib/user-profile");
    const { getNicknameCooldownDays, isMaintenanceMode } = require("../_lib/app-settings");
    const { getPublicKey } = require("../_lib/web-push");
    const { buildMapskyBridge } = require("../_lib/mapsky-bridge");

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
    if (req.query.action === "mapsky-bridge") {
      const cookiesBr = parseCookies(req);
      if (!verify(cookiesBr.nexora_session)) {
        return res.status(401).json({ ok: false, error: "請先登入", reason: "not-authenticated" });
      }
      let bodyBr = req.body;
      if (typeof bodyBr === "string") {
        try {
          bodyBr = JSON.parse(bodyBr);
        } catch {
          bodyBr = {};
        }
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

    const cookies = parseCookies(req);
    const payload = verify(cookies.nexora_session);
    if (!payload) {
      let maintenanceMode = false;
      try {
        maintenanceMode = await isMaintenanceMode();
      } catch (_) {}
      return res.status(200).json({ loggedIn: false, maintenanceMode });
    }
    try {
      const [isAdmin, memberId, custom, nicknameCooldownDays, maintenanceMode, betaTester, adventureSkipListed] =
        await Promise.all([
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
        updateChannelAccess: {
          publicBeta: isSuperAdmin || betaTester,
          internalBeta: isSuperAdmin,
        },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: String((err && err.message) || err).slice(0, 200) });
    }
  }
};
