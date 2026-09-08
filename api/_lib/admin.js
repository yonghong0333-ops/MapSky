// 後台管理權限判斷 —— 分兩層：
//
// 1. 超級管理員：寫在 Vercel 環境變數 ADMIN_IDS 裡，格式是「provider:id」
//    用逗號分隔，例如：facebook:1234567890,google:987654321
//    這一層是寫死的白名單，只能去 Vercel 後台改，App 本身沒有任何功能可以
//    新增/移除超級管理員，也不能把超級管理員踢掉——這是最高權限、誰都動不了。
//
// 2. 一般管理員：存在 Vercel KV（一個小型 key-value 資料庫）裡，可以在
//    App 的後台管理分頁直接指派、也可以直接踢除，不用改環境變數、不用重新部署。
//    只有超級管理員能指派/踢除一般管理員。
//
// 要啟用一般管理員功能，需要先在 Vercel 專案的 Storage 分頁加一個 KV 資料庫
// 並連接到這個專案（Vercel 會自動幫忙注入 KV_REST_API_URL 等環境變數，
// 不用自己填）。

const KV_ADMIN_LIST_KEY = "admin:dynamic-list";

function getSuperAdminIds() {
  return (process.env.ADMIN_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function sessionKey(payload) {
  if (!payload || !payload.provider || !payload.profile || !payload.profile.id) return null;
  return `${payload.provider}:${payload.profile.id}`;
}

function isSuperAdminSession(payload) {
  const key = sessionKey(payload);
  if (!key) return false;
  return getSuperAdminIds().includes(key);
}

// 動態一般管理員名單放在 KV，惰性 require，沒裝 KV 整合的話（例如本機開發、
// 或還沒去 Vercel 設定）就當作沒有一般管理員、只有超級管理員，不會整個壞掉。
function getKv() {
  try {
    return require("@vercel/kv").kv;
  } catch (e) {
    return null;
  }
}

async function getDynamicAdmins() {
  const kv = getKv();
  if (!kv) return [];
  try {
    const list = await kv.get(KV_ADMIN_LIST_KEY);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

async function isAdminSession(payload) {
  if (isSuperAdminSession(payload)) return true;
  const key = sessionKey(payload);
  if (!key) return false;
  const dynamicAdmins = await getDynamicAdmins();
  return dynamicAdmins.some((a) => a.key === key);
}

async function addDynamicAdmin({ provider, id, name }) {
  const kv = getKv();
  if (!kv) throw new Error("尚未設定 Vercel KV，無法指派一般管理員");
  const key = `${provider}:${id}`;
  if (getSuperAdminIds().includes(key)) {
    throw new Error("這個帳號已經是超級管理員了，不用另外指派");
  }
  const list = await getDynamicAdmins();
  if (list.some((a) => a.key === key)) {
    return list; // 已經是管理員了，不重複加
  }
  const next = [...list, { key, provider, id, name: name || id, addedAt: new Date().toISOString() }];
  await kv.set(KV_ADMIN_LIST_KEY, next);
  return next;
}

async function removeDynamicAdmin({ provider, id }) {
  const kv = getKv();
  if (!kv) throw new Error("尚未設定 Vercel KV，無法踢除一般管理員");
  const key = `${provider}:${id}`;
  if (getSuperAdminIds().includes(key)) {
    throw new Error("超級管理員不能被踢除");
  }
  const list = await getDynamicAdmins();
  const next = list.filter((a) => a.key !== key);
  await kv.set(KV_ADMIN_LIST_KEY, next);
  return next;
}

module.exports = {
  getSuperAdminIds,
  isSuperAdminSession,
  isAdminSession,
  getDynamicAdmins,
  addDynamicAdmin,
  removeDynamicAdmin,
};
