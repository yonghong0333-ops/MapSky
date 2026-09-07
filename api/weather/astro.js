// 合併日出日落 (sun)、月出月沒 (moon)、紫外線指數 (uv) 三支 API 成同一支
// serverless function，用 ?type=sun|moon|uv 區分——Vercel Hobby 方案對
// Serverless Functions 數量有上限（12 個），合併能省下名額。
const { getSunTimes, getMoonTimes, getMoonPhaseImage, getUvIndexObservation } = require("../_lib/cwa");
const { requireSession } = require("../_lib/require-session");

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;

  // 月相圖是二進位圖片，直接用 image/jpeg 回應（NASA 原圖格式，未去背），
  // 前端可以直接 <img src="/api/weather/astro?type=moonphase">。
  if (req.query.type === "moonphase") {
    try {
      const jpg = await getMoonPhaseImage({ forceRefresh: req.query.refresh === "1" });
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=1800");
      res.status(200).send(jpg);
    } catch (e) {
      res.status(502).json({ ok: false, reason: e.message });
    }
    return;
  }

  try {
    let result;
    if (req.query.type === "moon") {
      result = await getMoonTimes({ forceRefresh: req.query.refresh === "1" });
    } else if (req.query.type === "uv") {
      result = await getUvIndexObservation({ forceRefresh: req.query.refresh === "1" });
    } else {
      result = await getSunTimes({ forceRefresh: req.query.refresh === "1" });
    }
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ ok: false, reason: e.message });
  }
};
