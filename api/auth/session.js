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
  // App 專用 action，不會和其他 session action 撞名
  return a === "list" || a === "heartbeat" || a === "remove";
}

module.exports = async function handler(req, res) {
  if (isDevicesRequest(req)) {
    return handleDevicesSync(req, res);
  }

  if (await tryHandleStore(req, res)) return;

  return require("../_lib/session-handler").sessionHandler(req, res);
};
