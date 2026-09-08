// 會員 ID（MID）—— 讓一般使用者不用自己去查 provider/使用者 id 這種技術性的
// 資訊，登入後系統自動配一組好認、好複製貼上的短碼，使用者把這組碼傳給
// 超級管理員，管理員直接把 MID 貼進「指派管理員」表單就好。
//
// 存放方式：跟一般管理員名單一樣放 Vercel KV，兩個方向的對照都存：
//   mid:by-user:<provider>:<id>  -> MID（同一個帳號永遠拿到同一組 MID）
//   mid:by-id:<MID>              -> { provider, id, name }
//
// 沒有接 KV 的情況（本機開發、或還沒去 Vercel 設定）就沒辦法配發/查詢 MID，
// 回傳 null，前端要自己處理「暫時沒有 MID」的顯示。

function getKv() {
  try {
    return require("@vercel/kv").kv;
  } catch (e) {
    return null;
  }
}

// MID 格式：8 碼大寫英數字（去掉容易看錯的 0/O/1/I），例如 7K3F9QXA。
const MID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateMid() {
  let mid = "";
  for (let i = 0; i < 8; i++) {
    mid += MID_CHARS[Math.floor(Math.random() * MID_CHARS.length)];
  }
  return mid;
}

async function getOrCreateMemberId(payload) {
  const kv = getKv();
  if (!kv || !payload || !payload.provider || !payload.profile || !payload.profile.id) return null;
  const userKey = `mid:by-user:${payload.provider}:${payload.profile.id}`;
  try {
    const existing = await kv.get(userKey);
    if (existing) return existing;

    // 極小機率撞號才需要重試，8 碼英數字空間很大，撞到的機率可以忽略，
    // 但還是保守重試幾次比較安全。
    for (let attempt = 0; attempt < 5; attempt++) {
      const mid = generateMid();
      const idKey = `mid:by-id:${mid}`;
      const taken = await kv.get(idKey);
      if (taken) continue;
      await kv.set(idKey, {
        provider: payload.provider,
        id: payload.profile.id,
        name: payload.profile.name || payload.profile.id,
      });
      await kv.set(userKey, mid);
      return mid;
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function resolveMemberId(mid) {
  const kv = getKv();
  if (!kv || !mid) return null;
  try {
    const info = await kv.get(`mid:by-id:${mid.trim().toUpperCase()}`);
    return info || null;
  } catch (e) {
    return null;
  }
}

module.exports = { getOrCreateMemberId, resolveMemberId };
