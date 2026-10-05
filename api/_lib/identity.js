// 多個登入方式（Google／Facebook／.../Email 連結）如果對應到同一個真人
// （同一個 email），要讓使用者不管用哪個方式登入都進到「同一組資料」——
// 暱稱、大頭貼、推播訂閱、每日使用額度...這些全部都是拿 session payload
// 的 provider + profile.id 當 key（例如 adventure-usage.js 的
// sessionKey()），不是另外有一個獨立的「使用者資料表」。
//
// 做法刻意不去搬動任何既有資料、不新建一組獨立的 canonical user id：而是
// 「這個 email 第一次登入時用的是哪個 provider/id，就讓它當基準」，Redis
// 存一筆 email → { provider, id } 的對照表；之後不管哪一種登入方式，只要
// 查到的 email 一樣，都直接把這次 session 簽成第一次那組 provider/id，
// 等於是進到同一個帳號、原本的暱稱大頭貼都還在。沒有 email 可查（例如
// 使用者沒給 Facebook email 權限）的話，就維持各自獨立，不受影響，也不會
// 報錯——找不到 email 或 Redis 沒接上都只是直接放行原本的 provider/id。
const { getRedisClient } = require("./redis-client");

function emailKey(email) {
  return `identity:by-email:${String(email).trim().toLowerCase()}`;
}

// provider：這次登入方式的 id（"google"／"email"／...）
// profile：provider.mapProfile() 或 magic-link 流程組出來的物件，
//          至少要有 id；email 欄位可能不存在（該登入方式沒給 email）。
// 回傳：這次 session 真正該簽成誰的 { provider, profile }——profile 裡
//      其他欄位（name/avatarUrl/email）還是這次拿到的最新值，只有拿來
//      當 key 的 id（必要時連 provider 一起）會換成舊帳號那組。
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
        return { provider: existing.provider, profile: { ...profile, id: existing.id } };
      }
    }

    // 第一次看到這個 email：這次登入的 provider/id 就當作這個 email 以後
    // 的基準，記下來給之後其他登入方式比對用。
    await client.set(key, JSON.stringify({ provider, id: profile.id }));
    return { provider, profile };
  } catch (e) {
    console.error("resolveLoginIdentity failed", e.message);
    return { provider, profile };
  }
}

module.exports = { resolveLoginIdentity };
