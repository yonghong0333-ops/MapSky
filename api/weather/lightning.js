// 即時雷擊資料（中央氣象署 O-A0039-001），對地／雲間閃電的經緯度 + 時間。
// GET /api/weather/lightning
const { getLightning } = require("../_lib/cwa");

module.exports = async function handler(req, res) {
  try {
    const forceRefresh = req.query.refresh === "1";
    const result = await getLightning({ forceRefresh });
    if (!result.ok) {
      return res.status(200).json(result); // no-api-key 之類，前端自己判斷要不要顯示提示
    }
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ ok: false, reason: e.message });
  }
};
