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

module.exports = async function handler(req, res) {
  // /api/devices/sync 透過 vercel.json rewrite 進來（Hobby 方案 Serverless Function 上限 12）
  if (req.query.__devices === "1") {
    return handleDevicesSync(req, res);
  }

  if (await tryHandleStore(req, res)) return;

  // --- rest of original session.js will be restored in follow-up if this is still truncated ---
  return res.status(503).json({ ok: false, error: "session temporarily incomplete, restoring" });
};
