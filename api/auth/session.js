const { parseCookies } = require("../_lib/cookies");
const { verify } = require("../_lib/jwt");
const { isAdminSession } = require("../_lib/admin");
const { getOrCreateMemberId } = require("../_lib/member-id");
const { getUserProfile, setUserProfile } = require("../_lib/user-profile");
const { getNicknameCooldownDays } = require("../_lib/app-settings");

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
    const { nickname, avatarDataUrl, onboarded } = body || {};
    const patch = {};

    if (nickname !== undefined) {
      if (typeof nickname !== "string" || nickname.trim().length > 20) {
        return res.status(400).json({ ok: false, reason: "invalid-nickname" });
      }
      // 改名有冷卻時間限制（後台可調整天數），避免改過就馬上又改。
      const cooldownDays = await getNicknameCooldownDays();
      if (cooldownDays > 0) {
        const current = await getUserProfile(payload.provider, payload.profile.id);
        const lastChangedAt = current && current.nicknameChangedAt;
        if (lastChangedAt) {
          const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
          const elapsedMs = Date.now() - lastChangedAt;
          if (elapsedMs < cooldownMs) {
            const remainingDays = Math.ceil((cooldownMs - elapsedMs) / (24 * 60 * 60 * 1000));
            return res.status(429).json({
              ok: false,
              reason: "nickname-cooldown",
              remainingDays,
              cooldownDays,
              nextChangeAt: new Date(lastChangedAt + cooldownMs).toISOString(),
            });
          }
        }
      }
      patch.nickname = nickname.trim();
      patch.nicknameChangedAt = Date.now();
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
      onboarded: Boolean(custom && custom.onboarded),
      nicknameChangedAt: (custom && custom.nicknameChangedAt) || null,
    },
    isAdmin,
    memberId,
  });
};
