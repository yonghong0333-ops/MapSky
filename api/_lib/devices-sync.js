// 同帳號多裝置在線／電量／位置同步邏輯
// 由 api/auth/session.js 透過 rewrite 呼叫，避免多佔一個 Serverless Function（Hobby 上限 12）

const { requireSession } = require("./require-session");
const { getRedisClient } = require("./redis-client");

const ONLINE_WINDOW_SEC = 150;
const MAX_DEVICES = 10;
const TTL_SEC = 60 * 60 * 24 * 30; // 30 天
const HEARTBEAT_THROTTLE_SEC = 10;

function num(v, lo, hi) {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
}
function str(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function userKeyFromPayload(payload) {
  if (!payload || !payload.provider || !payload.profile || !payload.profile.id) return null;
  return String(payload.provider) + ":" + String(payload.profile.id);
}

function devicesKey(uid) {
  return `devices:${uid}`;
}

async function handleDevicesSync(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");

  const payload = requireSession(req, res);
  if (!payload) return; // 已回 401

  const uid = userKeyFromPayload(payload);
  if (!uid) {
    return res.status(401).json({ ok: false, reason: "not_logged_in" });
  }

  const key = devicesKey(uid);
  const action = (req.query && req.query.action) || "";

  let client;
  try {
    client = await getRedisClient();
  } catch (e) {
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
  if (!client) {
    return res.status(500).json({ ok: false, reason: "server_error" });
  }

  try {
    // ---------- heartbeat ----------
    if (action === "heartbeat") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, reason: "bad_action" });
      }

      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          body = {};
        }
      }
      body = body || {};

      const deviceId = str(body.deviceId, 64);
      if (!deviceId) {
        return res.status(400).json({ ok: false, reason: "bad_device" });
      }

      // 節流：同一 deviceId 10 秒內直接回 ok，不重寫
      const prevRaw = await client.hGet(key, deviceId);
      if (prevRaw) {
        try {
          const prev = JSON.parse(prevRaw);
          const nowSec = Math.floor(Date.now() / 1000);
          if (typeof prev.lastSeen === "number" && nowSec - prev.lastSeen < HEARTBEAT_THROTTLE_SEC) {
            return res.status(200).json({ ok: true });
          }
        } catch (_) {
          /* 壞資料就繼續寫 */
        }
      }

      // 新裝置數量檢查
      const exists = await client.hExists(key, deviceId);
      if (!exists) {
        const count = await client.hLen(key);
        if (count >= MAX_DEVICES) {
          return res.status(429).json({ ok: false, reason: "too_many_devices" });
        }
      }

      const rec = {
        deviceId,
        name: str(body.name, 60) || "未命名裝置",
        model: body.model === "iPad" ? "iPad" : "iPhone",
        os: str(body.os, 40),
        battery: num(body.battery, 0, 100),
        charging: !!body.charging,
        lowPower: !!body.lowPower,
        lastSeen: Math.floor(Date.now() / 1000),
      };

      const lat = num(body.lat, -90, 90);
      const lon = num(body.lon, -180, 180);
      if (lat !== undefined && lon !== undefined) {
        rec.lat = lat;
        rec.lon = lon;
        const acc = num(body.accuracy, 0, 100000);
        if (acc !== undefined) rec.accuracy = acc;
      }

      await client.hSet(key, deviceId, JSON.stringify(rec));
      await client.expire(key, TTL_SEC);

      return res.status(200).json({ ok: true });
    }

    // ---------- list ----------
    if (action === "list") {
      if (req.method !== "GET") {
        return res.status(405).json({ ok: false, reason: "bad_action" });
      }

      const all = await client.hGetAll(key);
      const now = Math.floor(Date.now() / 1000);
      const devices = [];

      for (const raw of Object.values(all || {})) {
        try {
          const d = JSON.parse(raw);
          d.online = now - (d.lastSeen || 0) < ONLINE_WINDOW_SEC;
          devices.push(d);
        } catch (_) {
          /* 壞資料略過 */
        }
      }

      return res.status(200).json({ ok: true, now, devices });
    }

    // ---------- remove ----------
    if (action === "remove") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, reason: "bad_action" });
      }

      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          body = {};
        }
      }
      body = body || {};

      const deviceId = str(body.deviceId, 64);
      if (!deviceId) {
        return res.status(400).json({ ok: false, reason: "bad_device" });
      }

      await client.hDel(key, deviceId);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, reason: "bad_action" });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
}

module.exports = { handleDevicesSync };
