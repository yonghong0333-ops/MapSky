const { parseCookies } = require("./cookies");
const { verify } = require("./jwt");
const { isAdminSession } = require("./admin");

/** @returns {Promise<boolean>} */
async function tryHandleGacha(req, res) {
  const action = req.query && req.query.action;
  if (!action) return false;
  const a = String(action);
  if (!(a.startsWith("gacha-") || a.startsWith("skyline-"))) return false;

  const cookiesS = parseCookies(req);
  const payloadS = verify(cookiesS.nexora_session);
  if (!payloadS) {
    res.status(401).json({ ok: false, error: "請先登入", reason: "not-authenticated" });
    return true;
  }

  try {
    const skyline = require("./skyline");

    if (action === "gacha-draw") {
      if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return true;
      }
      let bodyS = req.body;
      if (typeof bodyS === "string") {
        try {
          bodyS = JSON.parse(bodyS);
        } catch {
          bodyS = {};
        }
      }
      bodyS = bodyS || {};
      const idem =
        (req.headers && (req.headers["idempotency-key"] || req.headers["Idempotency-Key"])) ||
        bodyS.idempotencyKey ||
        null;
      const data = await skyline.gachaDraw(payloadS, {
        poolId: bodyS.poolId || "default",
        idempotencyKey: idem,
        transactionId: bodyS.transactionId || null,
      });
      res.status(data.ok ? 200 : 400).json(data);
      return true;
    }

    if (action === "gacha-odds") {
      if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return true;
      }
      const data = await skyline.gachaOdds();
      res.status(200).json(data);
      return true;
    }

    if (action === "skyline-list") {
      if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return true;
      }
      const data = await skyline.listOwnedForApp(payloadS);
      res.status(200).json({ items: data.items || [] });
      return true;
    }

    if (action === "skyline-upsert") {
      if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return true;
      }
      if (!(await isAdminSession(payloadS))) {
        res.status(403).json({ ok: false, reason: "not-admin" });
        return true;
      }
      let bodyS = req.body;
      if (typeof bodyS === "string") {
        try {
          bodyS = JSON.parse(bodyS);
        } catch {
          bodyS = {};
        }
      }
      const row = await skyline.upsertSkyline(bodyS || {});
      res.status(200).json({ ok: true, skyline: row });
      return true;
    }

    if (action === "skyline-grant") {
      if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return true;
      }
      if (!(await isAdminSession(payloadS))) {
        res.status(403).json({ ok: false, reason: "not-admin" });
        return true;
      }
      let bodyS = req.body;
      if (typeof bodyS === "string") {
        try {
          bodyS = JSON.parse(bodyS);
        } catch {
          bodyS = {};
        }
      }
      bodyS = bodyS || {};
      const target = bodyS.userKey || skyline.userKeyFromPayload(payloadS);
      const id = String(bodyS.skylineId || bodyS.id || "");
      const r = await skyline.grantSkyline(target, id, bodyS.source || "admin");
      res.status(200).json({ ok: true, userKey: target, duplicate: r.duplicate, record: r.record });
      return true;
    }

    if (action === "skyline-revoke") {
      if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return true;
      }
      if (!(await isAdminSession(payloadS))) {
        res.status(403).json({ ok: false, reason: "not-admin" });
        return true;
      }
      let bodyS = req.body;
      if (typeof bodyS === "string") {
        try {
          bodyS = JSON.parse(bodyS);
        } catch {
          bodyS = {};
        }
      }
      bodyS = bodyS || {};
      const target = bodyS.userKey || skyline.userKeyFromPayload(payloadS);
      await skyline.revokeSkyline(target, String(bodyS.skylineId || bodyS.id || ""));
      res.status(200).json({ ok: true, userKey: target });
      return true;
    }

    if (action === "skyline-admin-list") {
      if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return true;
      }
      if (!(await isAdminSession(payloadS))) {
        res.status(403).json({ ok: false, reason: "not-admin" });
        return true;
      }
      const all = await skyline.listAllMeta({ activeOnly: false });
      res.status(200).json({ ok: true, skylines: all });
      return true;
    }

    if (action === "skyline-owned-of") {
      if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return true;
      }
      if (!(await isAdminSession(payloadS))) {
        res.status(403).json({ ok: false, reason: "not-admin" });
        return true;
      }
      const target = String((req.query && req.query.userKey) || "");
      if (!target) {
        res.status(400).json({ ok: false, reason: "missing-userKey" });
        return true;
      }
      const ids = await skyline.listOwnedIds(target);
      res.status(200).json({ ok: true, userKey: target, skylineIds: ids });
      return true;
    }

    res.status(400).json({ ok: false, reason: "unknown-gacha-action" });
    return true;
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e).slice(0, 200) });
    return true;
  }
}

module.exports = { tryHandleGacha };
