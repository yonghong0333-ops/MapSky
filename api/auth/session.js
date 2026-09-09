const { parseCookies } = require("../_lib/cookies");
const { verify } = require("../_lib/jwt");
const { isAdminSession } = require("../_lib/admin");
const { getOrCreateMemberId } = require("../_lib/member-id");
const { getUserProfile, setUserProfile } = require("../_lib/user-profile");

module.exports = async function handler(req, res) {
  const cookies = parseCookies(req);
  const payload = verify(cookies.nexora_session);
  if (!payload) return res.status(200).json({ loggedIn: false });

  // 使用者更新自己的暱稱／大頭貼。只能改自己的（session 本人），
  // 不需要額外的權限判斷——任何登入的人都能改自己的暱稱/大頭貼。
  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    const { nickname, avatarDataUrl } = body || {};
    const patch = {};

    if (nickname !== undefined) {
      if (typeof nickname !== "string" || nickname.trim().length > 20) {
        return res.status(400).json({ ok: false, reason: "invalid-nickname" });
      }
      patch.nickname = nickname.trim();
    }
    if (avatarDataUrl !== undefined) {
      if (avatarDataUrl !== null) {
        if (typeof avatarDataUrl !== "string" || !avatarDataUrl.startsWith("data:image/")) {
          return res.status(400).json({ ok: false, reason: "invalid-avatar" });
        }
        // 粗略估一下 base64 還原後的大小，避免有人塞超大圖片把 Redis 塞爆
        const approxBytes = (avatarDataUrl.length * 3) / 4;
        if (approxBytes > 400 * 1024) {
          return res.status(400).json({ ok: false, reason: "avatar-too-large" });
        }
      }
      patch.avatarDataUrl = avatarDataUrl;
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

  const [isAdmin, memberId, custom] = await Promise.all([
    isAdminSession(payload),
    getOrCreateMemberId(payload),
    getUserProfile(payload.provider, payload.profile.id),
  ]);

  res.status(200).json({
    loggedIn: true,
    provider: payload.provider,
    profile: {
      ...payload.profile,
      nickname: (custom && custom.nickname) || null,
      avatarDataUrl: (custom && custom.avatarDataUrl) || null,
    },
    isAdmin,
    memberId,
  });
};
