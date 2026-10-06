// 多個登入方式（Google／Facebook／.../Email 連結）如果對應到同一個真人
// （同一個 email），要讓使用者不管用哪個方式登入都進到「同一組資料」——
// 暱稱、大頭貼、推播訂閱、每日使用額度...這些全部都是拿 session payload
// 的 provider + profile.id 當 key（例如 adventure-usage.js 的
// sessionKey()），不是另外有一個獨立的「使用者資料表」。
//
// Redis 存 email → { provider, id } 對照表。
// 規則：
// 1. 第一次看到的 email：以當次登入的 provider/id 為基準。
// 2. 之後同一 email：沿用既有基準。
// 3. 例外：若既有基準是 email magic-link，之後用 Google／Facebook 等
//    OAuth 登入，則「升級」為 OAuth 的 provider/id（避免 Email 先登入
//    把原本管理員／既有資料的 google:xxx 帳號吃掉）。
const { getRedisClient } = require("./redis-client");

function emailKey(email) {
  return `identity:by-email:${String(email).trim().toLowerCase()}`;
}

async function resolveLoginIdentity(provider, profile) {
  const email = profile && profile.email;
  if (!email || !profile || !profile.id) return { provider, profile };

  try {
    const client = await getRedisClient();
    if (!client) return { provider, profile };

    const key = emailKey(email);
    const existingRaw = await client.get(key);
    if (existingRaw) {
      let existing = null;
      try { existing = JSON.parse(existingRaw); } catch {}
      if (existing && existing.provider && existing.id) {
        // Email 先登入建立的基準，之後用 OAuth 登入 → 升級成 OAuth 身分
        // （管理員白名單多半是 google:xxx / facebook:xxx）
        if (existing.provider === "email" && provider !== "email") {
          await client.set(key, JSON.stringify({ provider, id: profile.id }));
          return { provider, profile };
        }
        return { provider: existing.provider, profile: { ...profile, id: existing.id } };
      }
    }

    await client.set(key, JSON.stringify({ provider, id: profile.id }));
    return { provider, profile };
  } catch (e) {
    console.error("resolveLoginIdentity failed", e.message);
    return { provider, profile };
  }
}

module.exports = { resolveLoginIdentity };
