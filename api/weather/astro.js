// 合併日出日落 (sun) 與月出月沒 (moon) 兩支 API 成同一支 serverless function，
// 用 ?type=sun|moon 區分——原本兩支各佔一個 function 名額，Vercel Hobby 方案
// 對 Serverless Functions 數量有上限（12 個），加入風速 (wind.js) 後會超過，
// 合併這兩支省下一個名額。
const { getSunTimes, getMoonTimes, getMoonPhaseImage } = require("../_lib/cwa");
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

  const wantMoon = req.query.type === "moon";
  try {
    const result = wantMoon
      ? await getMoonTimes({ forceRefresh: req.query.refresh === "1" })
      : await getSunTimes({ forceRefresh: req.query.refresh === "1" });
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ ok: false, reason: e.message });
  }
};
