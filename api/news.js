// 公開 API：最新消息 + 活動
// GET  /api/news              → { ok, items, events }
// GET  /api/news?type=news    → 只要最新消息
// GET  /api/news?type=events  → 只要活動
// POST /api/news?admin=1      → 管理員新增（需登入且為管理員）
//   body: { kind: "news"|"event", title, body, url, date, start, end, location }

const { parseCookies } = require("./_lib/cookies");
const { verify } = require("./_lib/jwt");
const { isAdminSession } = require("./_lib/admin");
const {
  listAnnouncements,
  listEvents,
  addAnnouncement,
  addEvent,
  ensureSeedNews,
} = require("./_lib/announcements");

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // ---- 公開讀取 ----
  if (req.method === "GET") {
    try {
      await ensureSeedNews();
      const type = String((req.query && req.query.type) || "all").toLowerCase();
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));

      if (type === "events") {
        const events = await listEvents(limit);
        res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
        return res.status(200).json({ ok: true, events, items: [] });
      }
      if (type === "news") {
        const items = await listAnnouncements(limit);
        res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
        return res.status(200).json({ ok: true, items, events: [] });
      }

      const [items, events] = await Promise.all([
        listAnnouncements(limit),
        listEvents(limit),
      ]);
      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
      return res.status(200).json({ ok: true, items, events });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: String((e && e.message) || e).slice(0, 200),
        items: [],
        events: [],
      });
    }
  }

  // ---- 管理員新增 ----
  if (req.method === "POST") {
    if (req.query.admin !== "1") {
      return res.status(400).json({ ok: false, reason: "bad-request" });
    }
    const cookies = parseCookies(req);
    const payload = verify(cookies.nexora_session);
    if (!payload) {
      return res.status(401).json({ ok: false, reason: "not-authenticated" });
    }
    if (!(await isAdminSession(payload))) {
      return res.status(403).json({ ok: false, reason: "not-admin" });
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
    const title = String(body.title || "").trim();
    if (!title) {
      return res.status(400).json({ ok: false, reason: "missing-title" });
    }

    const kind = String(body.kind || body.type || "news").toLowerCase();
    try {
      if (kind === "event") {
        const item = await addEvent({
          title,
          body: body.body || body.content || "",
          url: body.url || body.link || "/",
          date: body.date,
          start: body.start,
          end: body.end,
          location: body.location,
        });
        return res.status(200).json({ ok: true, event: item });
      }
      const item = await addAnnouncement({
        title,
        body: body.body || body.content || "",
        url: body.url || body.link || "/",
        date: body.date,
      });
      return res.status(200).json({ ok: true, item });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: String((e && e.message) || e).slice(0, 200),
      });
    }
  }

  return res.status(405).json({ ok: false, error: "Method not allowed" });
};
