/**
 * 帳號「上次定位」
 * - 前端有 GPS 時寫入
 * - 沒有定位時讀取，不預設任何縣市
 */
const { getRedisClient } = require("./redis-client");

const KEY_PREFIX = "user:lastloc:";

function userKeyFromPayload(payload) {
  if (!payload || !payload.provider || !payload.profile || !payload.profile.id) return null;
  return String(payload.provider) + ":" + String(payload.profile.id);
}

async function saveLastLocation(payload, loc) {
  const uk = userKeyFromPayload(payload);
  if (!uk) return null;
  const lat = Number(loc.lat);
  const lon = Number(loc.lon != null ? loc.lon : loc.lng);
  if (Number.isNaN(lat) || Number.isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }
  const row = {
    lat,
    lon,
    city: loc.city ? String(loc.city).slice(0, 32) : null,
    placeName: loc.placeName || loc.place ? String(loc.placeName || loc.place).slice(0, 80) : null,
    updatedAt: new Date().toISOString(),
  };
  try {
    const client = await getRedisClient();
    await client.set(KEY_PREFIX + uk, JSON.stringify(row));
    return row;
  } catch (e) {
    return null;
  }
}

async function getLastLocation(payload) {
  const uk = userKeyFromPayload(payload);
  if (!uk) return null;
  try {
    const client = await getRedisClient();
    const raw = await client.get(KEY_PREFIX + uk);
    if (!raw) return null;
    const row = JSON.parse(raw);
    if (row == null || Number.isNaN(Number(row.lat)) || Number.isNaN(Number(row.lon))) return null;
    return {
      lat: Number(row.lat),
      lon: Number(row.lon),
      city: row.city || null,
      placeName: row.placeName || null,
      updatedAt: row.updatedAt || null,
      source: "last-location",
    };
  } catch (e) {
    return null;
  }
}

module.exports = {
  userKeyFromPayload,
  saveLastLocation,
  getLastLocation,
};
