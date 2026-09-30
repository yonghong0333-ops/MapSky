// 鎖定畫面小工具專用、不用登入的天氣快照。
//
// 為什麼要另外開一支，不直接共用 /api/weather/city：那支要求先登入
// （requireSession，見 _lib/require-session.js），但 Widget Extension 是
// 完全獨立的行程，沒辦法帶著網頁的登入 cookie 一起跑，也不應該把整組
// session token 複製一份塞進 App Group 共用空間（等於把登入憑證明文放
// 到裝置上任何 process 都讀得到的地方，安全性不好）。
//
// 折衷做法：天氣本身是公開資訊（中央氣象署開放資料，任何人都查得到），
// 開一支不用登入、但只回傳「當下溫度／天氣狀況／圖示 key」這幾個欄位的
// 極簡端點，不像 /api/weather/city 那樣把完整一週逐三小時預報整包吐出去。
// CWA 的授權金鑰（CWA_API_KEY）還是只留在伺服器這邊，不會流到用戶端。
//
// 回傳的 conditionIcon 是跟網站 renderer.js 的 wxIconKeyForWx() 同一套
// key（sunny／partlyCloudy／overcast／rain／...），小工具那邊直接對應
// SF Symbol，不用自己重新判斷天氣文字。
const { getCity } = require("../_lib/cwa");

function getElement(weatherElements, name) {
  return (weatherElements || []).find((w) => w.elementName === name);
}

// 晚上 6 點～早上 6 點簡單當作晚上；小工具不知道日出日落精確時間，
// 這裡用一個粗略、夠用的判斷就好，不用真的去查天文API。
function isRoughlyNight(date) {
  const h = date.getHours();
  return h < 6 || h >= 18;
}

function wxIconKeyForWx(text, night) {
  if (!text) return night ? "sunnyNight" : "sunny";
  if (text.includes("超大豪雨")) return "extremeRain";
  if (text.includes("豪雨")) return "heavyRain";
  if (text.includes("毛毛雨")) return "drizzle";
  if (text.includes("雷") && text.includes("雨")) return "thunderstorm";
  if (text.includes("雷")) return "dryThunder";
  if (text.includes("雨")) return "rain";
  if (text.includes("多雲") && text.includes("晴")) return night ? "partlyCloudyNight" : "partlyCloudy";
  if (text.includes("陰") || text.includes("多雲")) return "overcast";
  if (text.includes("晴")) return night ? "sunnyNight" : "sunny";
  return night ? "sunnyNight" : "sunny";
}

module.exports = async function handler(req, res) {
  const city = req.query.city;
  if (!city) return res.status(400).json({ ok: false, reason: "missing-city" });

  try {
    const result = await getCity(String(city));
    if (!result.ok) return res.status(502).json(result);

    const elements = result.data.weatherElement || [];
    const wx = getElement(elements, "Wx");
    const minT = getElement(elements, "MinT");
    const maxT = getElement(elements, "MaxT");
    if (!wx || !wx.time || wx.time.length === 0) {
      return res.status(502).json({ ok: false, reason: "no-forecast-data" });
    }

    const wxNow = wx.time[0].parameter.parameterName;
    const minNow = minT ? minT.time[0].parameter.parameterName : "--";
    const maxNow = maxT ? maxT.time[0].parameter.parameterName : "--";
    const night = isRoughlyNight(new Date());

    // 小工具沒有自己的快取層，靠 Vercel 邊緣快取擋一下：同一個縣市 10 分鐘內
    // 重複請求直接吃快取，不用每次都真的再打一次 CWA（getCity 內部其實也有
    // 自己的伺服器端快取，這裡是多一層 CDN 快取，減少 function 執行次數）。
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=600, stale-while-revalidate=1800");
    res.status(200).json({
      ok: true,
      city,
      temperature: `${minNow}~${maxNow}°`,
      condition: wxNow,
      conditionIcon: wxIconKeyForWx(wxNow, night),
    });
  } catch (e) {
    res.status(502).json({ ok: false, reason: e.message });
  }
};
