// 合併日出日落 (sun) 與月出月沒 (moon) 兩支 API 成同一支 serverless function，
// 用 ?type=sun|moon 區分——原本兩支各佔一個 function 名額，Vercel Hobby 方案
// 對 Serverless Functions 數量有上限（12 個），加入風速 (wind.js) 後會超過，
// 合併這兩支省下一個名額。
const { getSunTimes, getMoonTimes } = require("../_lib/cwa");
const { requireSession } = require("../_lib/require-session");

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;
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
