/** 台灣縣市大致中心座標（用於未帶 GPS 時的天文／天氣定位） */
const CITY_COORDS = {
  基隆市: { lat: 25.1276, lon: 121.7392 },
  臺北市: { lat: 25.033, lon: 121.5654 },
  台北市: { lat: 25.033, lon: 121.5654 },
  新北市: { lat: 25.0169, lon: 121.4628 },
  桃園市: { lat: 24.9931, lon: 121.301 },
  新竹市: { lat: 24.8138, lon: 120.9675 },
  新竹縣: { lat: 24.8387, lon: 121.0177 },
  苗栗縣: { lat: 24.5602, lon: 120.8214 },
  臺中市: { lat: 24.1477, lon: 120.6736 },
  台中市: { lat: 24.1477, lon: 120.6736 },
  彰化縣: { lat: 24.0518, lon: 120.5161 },
  南投縣: { lat: 23.9609, lon: 120.9719 },
  雲林縣: { lat: 23.7092, lon: 120.4313 },
  嘉義市: { lat: 23.4801, lon: 120.4491 },
  嘉義縣: { lat: 23.4518, lon: 120.2555 },
  臺南市: { lat: 22.9997, lon: 120.227 },
  台南市: { lat: 22.9997, lon: 120.227 },
  高雄市: { lat: 22.6273, lon: 120.3014 },
  屏東縣: { lat: 22.5519, lon: 120.5487 },
  宜蘭縣: { lat: 24.7021, lon: 121.7377 },
  花蓮縣: { lat: 23.9871, lon: 121.6011 },
  臺東縣: { lat: 22.7972, lon: 121.0714 },
  台東縣: { lat: 22.7972, lon: 121.0714 },
  澎湖縣: { lat: 23.5711, lon: 119.5793 },
  金門縣: { lat: 24.4493, lon: 118.3767 },
  連江縣: { lat: 26.1605, lon: 119.9499 },
};

function normalizeCityName(name) {
  if (!name) return "";
  return String(name).replace(/台/g, "臺").trim();
}

/**
 * 從 query/body 解析觀測點
 * 優先 lat/lon（或 lng），否則 city／label 用縣市中心
 */
function resolveObserverLocation(input) {
  input = input || {};
  let lat = input.lat != null ? Number(input.lat) : null;
  let lon =
    input.lon != null
      ? Number(input.lon)
      : input.lng != null
        ? Number(input.lng)
        : null;

  if (lat != null && lon != null && !Number.isNaN(lat) && !Number.isNaN(lon)) {
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return { ok: false, reason: "invalid-lat-lon" };
    }
    return {
      ok: true,
      lat,
      lon,
      source: "gps",
      city: input.city ? normalizeCityName(input.city) : null,
      placeName: input.placeName || input.place || null,
    };
  }

  const cityRaw = input.city || input.label || input.location || "";
  const city = normalizeCityName(cityRaw);
  if (city && CITY_COORDS[city]) {
    const c = CITY_COORDS[city];
    return {
      ok: true,
      lat: c.lat,
      lon: c.lon,
      source: "city-center",
      city,
      placeName: input.placeName || input.place || null,
    };
  }
  // 嘗試不帶「市／縣」
  if (cityRaw) {
    for (const [name, c] of Object.entries(CITY_COORDS)) {
      if (name.indexOf(cityRaw) !== -1 || cityRaw.indexOf(name.replace(/[市縣]/g, "")) !== -1) {
        return {
          ok: true,
          lat: c.lat,
          lon: c.lon,
          source: "city-center",
          city: name.replace(/台/g, "臺"),
          placeName: input.placeName || input.place || null,
        };
      }
    }
  }

  return {
    ok: false,
    reason: "missing-location",
    hint: "請傳 lat+lon（手機定位），或 city=高雄市",
  };
}

module.exports = {
  CITY_COORDS,
  resolveObserverLocation,
  normalizeCityName,
};
