/**
 * MapSky App 橋接：一次回傳原生 UI／離線快取用資料
 * 由 session.js ?action=mapsky-bridge 呼叫
 */
const { getCity, getAlerts, getLightning, getRadarComposite, getWeeklyForecast, CWA_CITIES } = require("./cwa");

function normCity(name) {
  if (!name) return "";
  const s = String(name).replace(/台/g, "臺").trim();
  if (CWA_CITIES.indexOf(s) !== -1) return s;
  const map = {
    台北: "臺北市", 臺北: "臺北市", 台北市: "臺北市",
    新北: "新北市", 桃園: "桃園市", 台中: "臺中市", 臺中: "臺中市",
    台南: "臺南市", 臺南: "臺南市", 高雄: "高雄市",
    基隆: "基隆市", 新竹: "新竹市", 嘉義: "嘉義市",
    宜蘭: "宜蘭縣", 花蓮: "花蓮縣", 台東: "臺東縣", 臺東: "臺東縣",
    屏東: "屏東縣", 苗栗: "苗栗縣", 彰化: "彰化縣", 南投: "南投縣",
    雲林: "雲林縣", 澎湖: "澎湖縣", 金門: "金門縣", 馬祖: "連江縣", 連江: "連江縣",
  };
  if (map[s]) return map[s];
  for (const city of CWA_CITIES) {
    if (city.indexOf(s) !== -1 || s.indexOf(city.replace(/[市縣]/g, "")) !== -1) return city;
  }
  return "";
}

function periodsFromCityData(data) {
  if (!data) return [];
  const elements = data.weatherElement || data.WeatherElement || [];
  function timesOf(name) {
    const el = elements.find((e) => (e.elementName || e.ElementName) === name);
    return el ? (el.time || el.Time || []) : [];
  }
  const wx = timesOf("Wx");
  const pop = timesOf("PoP");
  const minT = timesOf("MinT");
  const maxT = timesOf("MaxT");
  const ci = timesOf("CI");
  const n = Math.max(wx.length, pop.length, minT.length, maxT.length);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const t = wx[i] || pop[i] || minT[i] || maxT[i] || {};
    const param = (x) => {
      if (!x) return null;
      const p = x.parameter || x.Parameter || {};
      return p.parameterName || p.ParameterName || null;
    };
    rows.push({
      startTime: t.startTime || t.StartTime || null,
      endTime: t.endTime || t.EndTime || null,
      weather: param(wx[i]),
      pop: param(pop[i]),
      minTemp: param(minT[i]),
      maxTemp: param(maxT[i]),
      comfort: param(ci[i]),
    });
  }
  return rows;
}

function build3DaysFromWeekly(periods) {
  const byDate = {};
  for (const p of periods || []) {
    const date = (p.startTime || "").slice(0, 10);
    if (!date) continue;
    if (!byDate[date]) {
      byDate[date] = { date, weather: null, weatherCode: null, minTemp: null, maxTemp: null, pop: null, periods: [] };
    }
    const d = byDate[date];
    if (p.weather) d.weather = p.weather;
    if (p.weatherCode) d.weatherCode = p.weatherCode;
    if (p.minTemp != null) {
      const v = Number(p.minTemp);
      d.minTemp = d.minTemp == null ? v : Math.min(d.minTemp, v);
    }
    if (p.maxTemp != null) {
      const v = Number(p.maxTemp);
      d.maxTemp = d.maxTemp == null ? v : Math.max(d.maxTemp, v);
    }
    if (p.pop != null) {
      const v = Number(p.pop);
      d.pop = d.pop == null ? v : Math.max(d.pop, v);
    }
    d.periods.push(p);
  }
  return Object.keys(byDate).sort().slice(0, 3).map((k) => byDate[k]);
}

function build3DaysFromShort(rows) {
  const byDate = {};
  for (const p of rows || []) {
    const date = (p.startTime || "").slice(0, 10);
    if (!date) continue;
    if (!byDate[date]) {
      byDate[date] = { date, weather: null, minTemp: null, maxTemp: null, pop: null, periods: [] };
    }
    const d = byDate[date];
    if (p.weather) d.weather = p.weather;
    if (p.minTemp != null) {
      const v = Number(p.minTemp);
      d.minTemp = d.minTemp == null ? v : Math.min(d.minTemp, v);
    }
    if (p.maxTemp != null) {
      const v = Number(p.maxTemp);
      d.maxTemp = d.maxTemp == null ? v : Math.max(d.maxTemp, v);
    }
    if (p.pop != null) {
      const v = Number(p.pop);
      d.pop = d.pop == null ? v : Math.max(d.pop, v);
    }
    d.periods.push(p);
  }
  return Object.keys(byDate).sort().slice(0, 3).map((k) => byDate[k]);
}

function attachWeekdays(days) {
  const names = ["日", "一", "二", "三", "四", "五", "六"];
  for (const d of days || []) {
    if (!d.date) continue;
    try {
      const dt = new Date(d.date + "T12:00:00+08:00");
      d.weekday = "週" + names[dt.getDay()];
    } catch (_) {}
  }
  return days;
}

/**
 * @param {{ city?: string, placeName?: string, lat?: number, lon?: number, include?: string, refresh?: boolean }} opts
 */
async function buildMapskyBridge(opts) {
  opts = opts || {};
  const cityRaw = opts.city || "";
  const placeName = opts.placeName || "";
  const lat = opts.lat != null ? Number(opts.lat) : null;
  const lon = opts.lon != null ? Number(opts.lon) : null;
  const includeRaw = String(opts.include || "weather,alerts,weekly");
  const include = includeRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const want = (k) => include.indexOf(k) !== -1 || include.indexOf("all") !== -1;
  const forceRefresh = Boolean(opts.refresh);
  const city = normCity(cityRaw) || "臺北市";

  const fetchedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const out = {
    ok: true,
    mapsky: true,
    bridge: "v1",
    fetchedAt,
    expiresAt,
    cacheHint: { ttlSeconds: 3600, storageKey: "mapsky.weather." + city, offlineOk: true },
    city,
    placeName: placeName || null,
    location: lat != null && lon != null && !Number.isNaN(lat) && !Number.isNaN(lon) ? { lat, lon } : null,
    ui: { headerTitle: city + " 天氣", subtitle: placeName || null, offlineBanner: null, cards: [] },
    forecast3Days: [],
    shortTerm: null,
    alerts: null,
    lightning: null,
    radar: null,
    notes: [],
  };
  if (!cityRaw) out.notes.push("未指定 city，使用 " + city);

  if (want("weather") || want("weekly")) {
    try {
      const wx = await getCity(city, { forceRefresh });
      if (wx && wx.ok !== false) {
        const data = wx.data || wx;
        const rows = periodsFromCityData(data);
        out.shortTerm = {
          city,
          locationName: data.locationName || data.LocationName || city,
          periods: rows,
        };
        if (!out.forecast3Days.length) out.forecast3Days = build3DaysFromShort(rows);
        const nowWx = rows[0];
        out.ui.cards.push({
          type: "weather",
          id: "weather-" + city,
          title: city,
          summary: nowWx
            ? [nowWx.weather, nowWx.minTemp && nowWx.maxTemp ? nowWx.minTemp + "～" + nowWx.maxTemp + "°" : null, nowWx.pop != null ? "降雨 " + nowWx.pop + "%" : null].filter(Boolean).join(" · ")
            : city + " 天氣",
          primary: nowWx ? nowWx.weather : null,
          minTemp: nowWx ? nowWx.minTemp : null,
          maxTemp: nowWx ? nowWx.maxTemp : null,
          pop: nowWx ? nowWx.pop : null,
        });
      } else out.notes.push("縣市預報無法取得");
    } catch (e) {
      out.notes.push("縣市預報錯誤：" + String((e && e.message) || e).slice(0, 120));
    }
  }

  if (want("weekly") || want("weather")) {
    try {
      const weekly = await getWeeklyForecast({ forceRefresh });
      if (weekly && weekly.ok !== false && weekly.counties) {
        const periods = weekly.counties[city] || [];
        const days = build3DaysFromWeekly(periods);
        if (days.length) {
          out.forecast3Days = days;
          out.ui.cards.push({
            type: "forecast3",
            id: "forecast3-" + city,
            title: "未來三天",
            days: days.map((d) => ({
              date: d.date,
              weekday: null,
              weather: d.weather,
              minTemp: d.minTemp,
              maxTemp: d.maxTemp,
              pop: d.pop,
            })),
          });
        }
      }
    } catch (e) {
      out.notes.push("一週預報錯誤：" + String((e && e.message) || e).slice(0, 120));
    }
  }

  if (want("alerts")) {
    try {
      out.alerts = await getAlerts({ forceRefresh });
      out.ui.cards.push({ type: "alerts", id: "alerts", title: "警特報", summary: "MapSky 警特報" });
    } catch (e) {
      out.notes.push("警特報錯誤：" + String((e && e.message) || e).slice(0, 80));
    }
  }

  if (want("lightning")) {
    try {
      out.lightning = await getLightning({ forceRefresh });
      out.ui.cards.push({ type: "lightning", id: "lightning", title: "即時雷擊", summary: "MapSky 雷擊" });
    } catch (e) {
      out.notes.push("雷擊錯誤：" + String((e && e.message) || e).slice(0, 80));
    }
  }

  if (want("radar")) {
    try {
      const rd = await getRadarComposite({ forceRefresh });
      out.radar = rd;
      const imgUrl =
        (rd && (rd.imageUrl || rd.url || rd.image || (rd.data && (rd.data.imageUrl || rd.data.url)))) || null;
      out.ui.cards.push({ type: "radar", id: "radar", title: "雷達回波", summary: "MapSky 雷達", imageUrl: imgUrl });
    } catch (e) {
      out.notes.push("雷達錯誤：" + String((e && e.message) || e).slice(0, 80));
    }
  }

  attachWeekdays(out.forecast3Days);
  const fc = out.ui.cards.find((c) => c.type === "forecast3");
  if (fc && fc.days) {
    for (let i = 0; i < fc.days.length; i++) {
      fc.days[i].weekday = (out.forecast3Days[i] && out.forecast3Days[i].weekday) || null;
    }
  }

  return out;
}

module.exports = { buildMapskyBridge };
