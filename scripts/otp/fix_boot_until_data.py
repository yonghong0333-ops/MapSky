#!/usr/bin/env python3
from pathlib import Path

# --- CSS: keep boot overlay visible even after auth-ok ---
css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")
old_css = "body.auth-ok .login-gate {\n  display: none;\n}"
# variants
if "login-gate.login-gate--booting" in css and "auth-ok" in css:
    # check if already has override
    if "body.auth-ok .login-gate.login-gate--booting" in css:
        print("css already")
    else:
        # insert after body.auth-ok .login-gate rule
        needle = "body.auth-ok .login-gate"
        idx = css.find(needle)
        if idx < 0:
            raise SystemExit("auth-ok login-gate rule missing")
        # find end of that rule block
        brace = css.find("{", idx)
        end = css.find("}", brace)
        insert_at = end + 1
        override = (
            "\nbody.auth-ok .login-gate.login-gate--booting {\n"
            "  display: flex; /* 已登入但仍在等天氣資料時，繼續顯示全螢幕載入 */\n"
            "}\n"
        )
        css = css[:insert_at] + override + css[insert_at:]
        css_path.write_text(css, encoding="utf-8")
        print("css ok")
else:
    if "body.auth-ok .login-gate.login-gate--booting" in css:
        print("css already")
    else:
        css += (
            "\nbody.auth-ok .login-gate.login-gate--booting {\n"
            "  display: flex;\n"
            "}\n"
        )
        css_path.write_text(css, encoding="utf-8")
        print("css append ok")

# --- web-shim: logged-in waits for weather ready ---
js_path = Path("public/web-shim.js")
js = js_path.read_text(encoding="utf-8")

# Replace logged-in block start to delay endLoginGateBoot
old = (
    "    if (session.loggedIn) {\n"
    "      endLoginGateBoot();\n"
    "      document.body.classList.add(\"auth-ok\");"
)
new = (
    "    if (session.loggedIn) {\n"
    "      // 已登入：等天氣資料出來再停轉圈（renderer 會呼叫 __mapskyOnWeatherDataReady）\n"
    "      document.body.classList.add(\"auth-ok\");\n"
    "      window.__mapskyOnWeatherDataReady = function () {\n"
    "        window.__mapskyOnWeatherDataReady = null;\n"
    "        endLoginGateBoot();\n"
    "      };\n"
    "      // 延長安全上限：等資料最多 20 秒\n"
    "      if (loginGateBootSafetyTimer) clearTimeout(loginGateBootSafetyTimer);\n"
    "      loginGateBootSafetyTimer = setTimeout(function () {\n"
    "        try { endLoginGateBoot(); } catch (e) {}\n"
    "      }, 20000);"
)

if "__mapskyOnWeatherDataReady" in js and "等天氣資料出來再停轉圈" in js:
    print("shim already")
elif old in js:
    js = js.replace(old, new, 1)
    print("shim logged-in ok")
elif "if (session.loggedIn) {\n      endLoginGateBoot();" in js:
    js = js.replace(
        "    if (session.loggedIn) {\n      endLoginGateBoot();\n      document.body.classList.add(\"auth-ok\");",
        new.replace("    if (session.loggedIn) {", "    if (session.loggedIn) {", 1),
        1,
    )
    print("shim alt ok")
else:
    # maybe endLoginGateBoot already missing on logged path
    old2 = "    if (session.loggedIn) {\n      document.body.classList.add(\"auth-ok\");"
    if old2 in js and "__mapskyOnWeatherDataReady" not in js:
        js = js.replace(old2, new, 1)
        print("shim no-end ok")
    else:
        print("WARN shim pattern")

js_path.write_text(js, encoding="utf-8")

# --- renderer: signal when weather data is shown ---
r_path = Path("public/renderer.js")
r = r_path.read_text(encoding="utf-8")

if "__mapskyOnWeatherDataReady" in r:
    print("renderer already")
else:
    # Add helper once
    helper = (
        "\nfunction notifyWeatherDataReady() {\n"
        "  try {\n"
        "    if (typeof window.__mapskyOnWeatherDataReady === \"function\") {\n"
        "      window.__mapskyOnWeatherDataReady();\n"
        "    }\n"
        "  } catch (e) {}\n"
        "}\n"
    )
    # insert after cityWeatherCache load
    marker = "const cityWeatherCache = loadCityWeatherCache();"
    if marker in r:
        r = r.replace(marker, marker + helper, 1)
        print("renderer helper ok")
    else:
        r = helper + r
        print("renderer helper prepend")

    # After renderWeather(cached) in selectCity
    old_c = (
        "  if (cached) {\n"
        "    // 有舊資料：先直接顯示，不擋畫面，背景再悄悄刷新\n"
        "    renderWeather(cached);\n"
        "    setStatus(\"資料更新中…\");\n"
        "  } else {"
    )
    new_c = (
        "  if (cached) {\n"
        "    // 有舊資料：先直接顯示，不擋畫面，背景再悄悄刷新\n"
        "    renderWeather(cached);\n"
        "    notifyWeatherDataReady();\n"
        "    setStatus(\"資料更新中…\");\n"
        "  } else {"
    )
    if old_c in r:
        r = r.replace(old_c, new_c, 1)
        print("renderer cache ok")

    # After successful fetch renderWeather
    old_f = (
        "    if (currentCity && currentCity.label === label) {\n"
        "      renderWeather(location);\n"
        "      setStatus(\"更新完成\");\n"
        "    }"
    )
    new_f = (
        "    if (currentCity && currentCity.label === label) {\n"
        "      renderWeather(location);\n"
        "      notifyWeatherDataReady();\n"
        "      setStatus(\"更新完成\");\n"
        "    }"
    )
    if old_f in r:
        r = r.replace(old_f, new_f, 1)
        print("renderer fetch ok")

    # On failure without cache - still end boot so user isn't stuck
    old_e = (
        "    if (currentCity && currentCity.label === label) {\n"
        "      // 有舊資料可以顯示的話，刷新失敗就默默保留舊畫面就好，不用跳錯誤嚇使用者\n"
        "      setStatus(cached ? \"更新完成（顯示上次資料）\" : `取得天氣資料失敗：${e.message}`);\n"
        "    }"
    )
    new_e = (
        "    if (currentCity && currentCity.label === label) {\n"
        "      // 有舊資料可以顯示的話，刷新失敗就默默保留舊畫面就好，不用跳錯誤嚇使用者\n"
        "      setStatus(cached ? \"更新完成（顯示上次資料）\" : `取得天氣資料失敗：${e.message}`);\n"
        "      notifyWeatherDataReady();\n"
        "    }"
    )
    if old_e in r:
        r = r.replace(old_e, new_e, 1)
        print("renderer err ok")

    r_path.write_text(r, encoding="utf-8")

print("DONE")
