#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from pathlib import Path

path = Path("public/renderer.js")
text = path.read_text(encoding="utf-8")
if "OFFLINE_WEATHER_BUNDLE_KEY" in text:
    print("already patched")
    raise SystemExit(0)

insert_after = "const cityWeatherCache = loadCityWeatherCache();\n"
helper = r'''
const OFFLINE_WEATHER_BUNDLE_KEY = "mapsky_offline_weather_bundle_v1";
function isProbablyOffline() {
  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  } catch (e) {}
  return false;
}
function persistOfflineWeatherBundle() {
  try {
    const bundle = {
      savedAt: Date.now(),
      cities: cityWeatherCache,
      weekly: typeof weeklyForecastCache !== "undefined" ? weeklyForecastCache : null,
      sun: typeof sunTimesCache !== "undefined" ? sunTimesCache : null,
      moon: typeof moonTimesCache !== "undefined" ? moonTimesCache : null,
      moonDate: typeof moonTimesCacheDate !== "undefined" ? moonTimesCacheDate : "",
      wind: typeof windObsCache !== "undefined" ? windObsCache : null,
      uv: typeof uvIndexCache !== "undefined" ? uvIndexCache : null,
      uvAt: typeof uvIndexCacheAt !== "undefined" ? uvIndexCacheAt : 0,
    };
    localStorage.setItem(OFFLINE_WEATHER_BUNDLE_KEY, JSON.stringify(bundle));
  } catch (e) {}
}
function restoreOfflineWeatherBundle() {
  try {
    const raw = localStorage.getItem(OFFLINE_WEATHER_BUNDLE_KEY);
    if (!raw) return null;
    const bundle = JSON.parse(raw);
    if (!bundle || typeof bundle !== "object") return null;
    if (bundle.cities && typeof bundle.cities === "object") {
      Object.keys(bundle.cities).forEach((k) => {
        if (!cityWeatherCache[k]) cityWeatherCache[k] = bundle.cities[k];
      });
    }
    return bundle;
  } catch (e) {
    return null;
  }
}
const __offlineBundleBoot = restoreOfflineWeatherBundle();
function formatOfflineAge(ms) {
  if (!ms || !Number.isFinite(ms)) return "";
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return "剛剛";
  if (mins < 60) return mins + " 分鐘前";
  const hours = Math.round(mins / 60);
  if (hours < 48) return hours + " 小時前";
  const days = Math.round(hours / 24);
  return days + " 天前";
}
'''
if insert_after not in text:
    raise SystemExit("insert point missing")
text = text.replace(insert_after, insert_after + helper, 1)

old = """    cityWeatherCache[label] = location;
    saveCityWeatherCache();
    if (currentCity && currentCity.label === label) {
      renderWeather(location);
      setStatus("更新完成");
    }
  } catch (e) {
    if (currentCity && currentCity.label === label) {
      // 有舊資料可以顯示的話，刷新失敗就默默保留舊畫面就好，不用跳錯誤嚇使用者
      setStatus(cached ? "更新完成（顯示上次資料）" : `取得天氣資料失敗：${e.message}`);
    }
  }"""
new = """    cityWeatherCache[label] = location;
    saveCityWeatherCache();
    persistOfflineWeatherBundle();
    if (currentCity && currentCity.label === label) {
      renderWeather(location);
      setStatus(isProbablyOffline() ? "離線模式・顯示已備份資料" : "更新完成");
    }
  } catch (e) {
    if (currentCity && currentCity.label === label) {
      const offline = isProbablyOffline();
      if (cached) {
        const age = __offlineBundleBoot && __offlineBundleBoot.savedAt
          ? formatOfflineAge(__offlineBundleBoot.savedAt)
          : "";
        setStatus(
          offline
            ? ("離線模式・顯示上次備份" + (age ? "（" + age + "）" : ""))
            : "更新完成（顯示上次資料）"
        );
      } else {
        setStatus(
          offline
            ? "目前沒有網路，且尚無此縣市的備份資料"
            : `取得天氣資料失敗：${e.message}`
        );
      }
    }
  }"""
if old not in text:
    raise SystemExit("selectCity block missing")
text = text.replace(old, new, 1)

replacements = [
    ("let sunTimesCache = null;", "let sunTimesCache = (__offlineBundleBoot && __offlineBundleBoot.sun) || null;"),
    ("sunTimesCache = result.counties || {};\n    }", "sunTimesCache = result.counties || {};\n      persistOfflineWeatherBundle();\n    }"),
    ("let moonTimesCache = null;\nlet moonTimesCacheDate = \"\"; // 快取對應的日期，跨日就要重抓",
     "let moonTimesCache = (__offlineBundleBoot && __offlineBundleBoot.moon) || null;\nlet moonTimesCacheDate = (__offlineBundleBoot && __offlineBundleBoot.moonDate) || \"\"; // 快取對應的日期，跨日就要重抓"),
    ("moonTimesCacheDate = todayKey;\n    }", "moonTimesCacheDate = todayKey;\n      persistOfflineWeatherBundle();\n    }"),
    ("let weeklyForecastCache = null;", "let weeklyForecastCache = (__offlineBundleBoot && __offlineBundleBoot.weekly) || null;"),
    ("weeklyForecastCache = result.counties || {};\n    }", "weeklyForecastCache = result.counties || {};\n      persistOfflineWeatherBundle();\n    }"),
    ("let windObsCache = null;", "let windObsCache = (__offlineBundleBoot && __offlineBundleBoot.wind) || null;"),
    ("windObsCache = result.counties || {};\n    }", "windObsCache = result.counties || {};\n      persistOfflineWeatherBundle();\n    }"),
    ("let uvIndexCache = null;\nlet uvIndexCacheAt = 0;", "let uvIndexCache = (__offlineBundleBoot && __offlineBundleBoot.uv) || null;\nlet uvIndexCacheAt = (__offlineBundleBoot && __offlineBundleBoot.uvAt) || 0;"),
    ("uvIndexCacheAt = Date.now();\n    }", "uvIndexCacheAt = Date.now();\n      persistOfflineWeatherBundle();\n    }"),
]
for o, n in replacements:
    if o not in text:
        raise SystemExit(f"missing: {o[:60]!r}")
    text = text.replace(o, n, 1)

listener = """

// 有網路時自動把目前記憶體裡的天氣資料再備份一次；斷線時提示使用上次資料
window.addEventListener("online", () => {
  try { persistOfflineWeatherBundle(); } catch (e) {}
  if (currentCity && currentCity.label) {
    setStatus("網路已恢復，正在更新…");
    selectCity(currentCity.label);
  }
});
window.addEventListener("offline", () => {
  const age = __offlineBundleBoot && __offlineBundleBoot.savedAt
    ? formatOfflineAge(__offlineBundleBoot.savedAt)
    : "";
  setStatus("目前沒有網路" + (age ? "・顯示 " + age + " 的備份" : "・若有備份仍可查看"));
});
"""
if 'window.addEventListener("online"' not in text:
    text = text.rstrip() + "\n" + listener

path.write_text(text, encoding="utf-8")
print("patched size", path.stat().st_size)
assert "OFFLINE_WEATHER_BUNDLE_KEY" in text
