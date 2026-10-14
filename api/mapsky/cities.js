/**
 * GET /api/mapsky/cities
 * 回傳 MapSky 支援的縣市清單（中央氣象署 F-C0032-001）
 * 需登入。
 */
const { requireSession } = require("../_lib/require-session");
const { CWA_CITIES } = require("../_lib/cwa");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!requireSession(req, res)) return;

  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.status(200).json({
    ok: true,
    cities: CWA_CITIES.slice(),
    count: CWA_CITIES.length,
  });
};
