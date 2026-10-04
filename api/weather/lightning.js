// 地圖圖層資料，目前有兩種（用 ?layer= 區分，不新增檔案，Vercel Hobby
// 方案 12 支 function 的上限已經滿了，見 cwa.js 開頭/commit 紀錄）：
//   layer=lightning（預設）：即時雷擊（O-A0039-001）
//   layer=radar          ：雷達整合回波圖（O-A0058-001），回傳圖片網址 + 範圍
// GET /api/weather/lightning[?layer=radar][&refresh=1]
const { getLightning, getRadarComposite } = require("../_lib/cwa");

module.exports = async function handler(req, res) {
  try {
    const forceRefresh = req.query.refresh === "1";
    const layer = req.query.layer === "radar" ? "radar" : "lightning";
    const result = layer === "radar"
      ? await getRadarComposite({ forceRefresh })
      : await getLightning({ forceRefresh });
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ ok: false, reason: e.message });
  }
};
