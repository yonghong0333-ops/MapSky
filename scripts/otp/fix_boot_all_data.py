#!/usr/bin/env python3
from pathlib import Path

r_path = Path("public/renderer.js")
r = r_path.read_text(encoding="utf-8")

# Remove early notify calls in selectCity; notify only after side data
old_block = '''  const cached = cityWeatherCache[label];
  if (cached) {
    // 有舊資料：先直接顯示，不擋畫面，背景再悄悄刷新
    renderWeather(cached);
    notifyWeatherDataReady();
    setStatus("資料更新中…");
  } else {
    // 第一次查這個縣市，還沒有任何資料可以先顯示，只好等
    setStatus("載入天氣資料中…");
  }

  try {
    const location = await fetchCityWeather(label);
    // 使用者可能在資料回來前已經切換到別的縣市，這裡要避免覆蓋錯畫面
    cityWeatherCache[label] = location;
    saveCityWeatherCache();
    if (currentCity && currentCity.label === label) {
      renderWeather(location);
      notifyWeatherDataReady();
      setStatus("更新完成");
    }
  } catch (e) {
    if (currentCity && currentCity.label === label) {
      // 有舊資料可以顯示的話，刷新失敗就默默保留舊畫面就好，不用跳錯誤嚇使用者
      setStatus(cached ? "更新完成（顯示上次資料）" : `取得天氣資料失敗：${e.message}`);
      notifyWeatherDataReady();
    }
  }

  loadSunTimes(label);
  loadMoonTimes(label);
  loadWindObservation(label);
  loadUvIndex(label);
  loadMoonPhaseImage();
  loadWeeklyForecast(label);
}'''

new_block = '''  const cached = cityWeatherCache[label];
  if (cached) {
    // 有舊資料：先直接顯示，不擋畫面，背景再悄悄刷新
    renderWeather(cached);
    setStatus("資料更新中…");
  } else {
    // 第一次查這個縣市，還沒有任何資料可以先顯示，只好等
    setStatus("載入天氣資料中…");
  }

  try {
    const location = await fetchCityWeather(label);
    // 使用者可能在資料回來前已經切換到別的縣市，這裡要避免覆蓋錯畫面
    cityWeatherCache[label] = location;
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
  }

  // 等主天氣 + 日出日落／月相／風／紫外線／一週預報都跑完，再通知關閉開機轉圈
  try {
    await Promise.allSettled([
      loadSunTimes(label),
      loadMoonTimes(label),
      loadWindObservation(label),
      loadUvIndex(label),
      Promise.resolve(loadMoonPhaseImage()),
      loadWeeklyForecast(label),
    ]);
  } catch (e) {}
  if (currentCity && currentCity.label === label) {
    notifyWeatherDataReady();
  }
}'''

if old_block in r:
    r = r.replace(old_block, new_block, 1)
    print("selectCity ok")
elif "等主天氣 + 日出日落" in r:
    print("already updated")
else:
    raise SystemExit("selectCity block not found")

# Bump safety timeout in web-shim to 30s for more data
js_path = Path("public/web-shim.js")
js = js_path.read_text(encoding="utf-8")
if "20000" in js and "__mapskyOnWeatherDataReady" in js:
    js2 = js.replace(
        "loginGateBootSafetyTimer = setTimeout(function () {\n        try { endLoginGateBoot(); } catch (e) {}\n      }, 20000);",
        "loginGateBootSafetyTimer = setTimeout(function () {\n        try { endLoginGateBoot(); } catch (e) {}\n      }, 30000);",
        1,
    )
    if js2 != js:
        js = js2
        print("timeout 30s")
    else:
        # try other patterns
        js = js.replace("}, 20000);", "}, 30000);", 1)
        print("timeout replace fallback")

r_path.write_text(r, encoding="utf-8")
js_path.write_text(js, encoding="utf-8")
print("DONE")
