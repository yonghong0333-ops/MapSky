const storeLib = require("./store");
const { parseCookies } = require("./cookies");
const { verify } = require("./jwt");
const { isAdminSession } = require("./admin");
const { tryHandleGacha } = require("./session-gacha-actions");
const {
  listAnnouncements,
  listEvents,
  ensureSeedNews,
} = require("./announcements");

/** @returns {Promise<boolean>} true if handled */
async function tryHandleStore(req, res) {
  if (await tryHandleGacha(req, res)) return true;

  const action = req.query && req.query.action;

  // 公開：最新消息／活動（不必登入）— 給 iOS 日曆頁與官網用
  if (action === "list-news" || action === "list-events") {
    try {
      await ensureSeedNews();
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
      if (action === "list-events") {
        const events = await listEvents(limit);
        res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.status(200).json({ ok: true, events, items: [] });
        return true;
      }
      const [items, events] = await Promise.all([
        listAnnouncements(limit),
        listEvents(limit),
      ]);
      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.status(200).json({ ok: true, items, events });
      return true;
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: String((e && e.message) || e).slice(0, 200),
        items: [],
        events: [],
      });
      return true;
    }
  }

  if (!action || !String(action).startsWith("store-")) return false;

  const cookiesS = parseCookies(req);
  const payloadS = verify(cookiesS.nexora_session);
  if (!payloadS) {
    res.status(401).json({ ok: false, error: "請先登入", reason: "not-authenticated" });
    return true;
  }

  try {
    if (action === "store-today") {
      if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return true;
      }
      const data = await storeLib.todayShelfForUser(payloadS);
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(data);
      return true;
    }
    if (action === "store-owned") {
      if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return true;
      }
      const data = await storeLib.ownedForUser(payloadS);
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(data);
      return true;
    }
    if (action === "store-purchase") {
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
      if (bodyS.testGrant && !(await isAdminSession(payloadS))) {
        res.status(403).json({ ok: false, reason: "not-admin" });
        return true;
      }
      const data = await storeLib.purchaseForUser(payloadS, bodyS);
      res.status(data.ok ? 200 : 400).json(data);
      return true;
    }
    if (action === "store-unlock") {
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
      const data = await storeLib.unlockForUser(payloadS, bodyS || {});
      res.status(data.ok ? 200 : 403).json(data);
      return true;
    }
    if (action === "store-products") {
      if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return true;
      }
      const products = await storeLib.listProducts({ activeOnly: req.query.all !== "1" });
      res.status(200).json({ ok: true, products });
      return true;
    }
    if (action === "store-product-upsert") {
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
      const product = await storeLib.upsertProduct(bodyS || {});
      res.status(200).json({ ok: true, product });
      return true;
    }
    if (action === "store-shelf-get") {
      if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return true;
      }
      const shelf = await storeLib.getShelf(req.query.date || undefined);
      res.status(200).json({ ok: true, shelf });
      return true;
    }
    if (action === "store-shelf-set") {
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
      const shelf = await storeLib.setShelf(bodyS.date, bodyS.slots || bodyS.productIds);
      res.status(200).json({ ok: true, shelf });
      return true;
    }
    if (action === "store-grant") {
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
      const target = bodyS.userKey || storeLib.userKey(payloadS);
      if (!target) {
        res.status(400).json({ ok: false, reason: "missing-userKey" });
        return true;
      }
      const productId = String(bodyS.productId || "").trim();
      if (!productId) {
        res.status(400).json({ ok: false, reason: "missing-productId" });
        return true;
      }
      const ent = await storeLib.grantEntitlement(target, productId, { source: "admin" });
      res.status(200).json({ ok: true, userKey: target, entitlement: ent });
      return true;
    }
    res.status(400).json({ ok: false, reason: "unknown-store-action" });
    return true;
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e).slice(0, 200) });
    return true;
  }
}

module.exports = { tryHandleStore };
