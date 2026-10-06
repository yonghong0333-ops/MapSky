#!/usr/bin/env python3
from pathlib import Path

js_path = Path("public/web-shim.js")
js = js_path.read_text(encoding="utf-8")

# 1) maintenance path
old_m = (
    "    if (session.maintenanceMode && !isAdminUser) {\n"
    "      showMaintenanceScreen(session, providers);\n"
    "      return;\n"
    "    }"
)
new_m = (
    "    if (session.maintenanceMode && !isAdminUser) {\n"
    "      endLoginGateBoot();\n"
    "      showMaintenanceScreen(session, providers);\n"
    "      return;\n"
    "    }"
)
if "endLoginGateBoot();\n      showMaintenanceScreen" in js:
    print("maint already")
elif old_m in js:
    js = js.replace(old_m, new_m, 1)
    print("maint ok")
else:
    print("WARN maint pattern missing")

# 2) logged-in path
old_l = (
    "    if (session.loggedIn) {\n"
    "      document.body.classList.add(\"auth-ok\");"
)
new_l = (
    "    if (session.loggedIn) {\n"
    "      endLoginGateBoot();\n"
    "      document.body.classList.add(\"auth-ok\");"
)
if "if (session.loggedIn) {\n      endLoginGateBoot();" in js:
    print("logged already")
elif old_l in js:
    js = js.replace(old_l, new_l, 1)
    print("logged ok")
else:
    print("WARN logged pattern missing")

# 3) not-logged-in path — before status clear
old_n = (
    "    // 未登入：把主畫面繼續擋著，只在登入畫面上顯示可用的登入方式。\n"
    "    // 預設只露出 Google／Facebook 兩個，其他的收起來，點「更多登入方式」\n"
    "    // 才展開——同一批 providers，只是依 id 分成兩組渲染，按鈕本身\n"
    "    // （buildGateButtons）完全沒變。\n"
    "    if (statusEl) {"
)
new_n = (
    "    // 未登入：把主畫面繼續擋著，只在登入畫面上顯示可用的登入方式。\n"
    "    // 預設只露出 Google／Facebook 兩個，其他的收起來，點「更多登入方式」\n"
    "    // 才展開——同一批 providers，只是依 id 分成兩組渲染，按鈕本身\n"
    "    // （buildGateButtons）完全沒變。\n"
    "    endLoginGateBoot();\n"
    "    if (statusEl) {"
)
if "完全沒變。\n    endLoginGateBoot();\n    if (statusEl)" in js:
    print("nologin already")
elif old_n in js:
    js = js.replace(old_n, new_n, 1)
    print("nologin ok")
else:
    # shorter fallback
    old2 = "    // （buildGateButtons）完全沒變。\n    if (statusEl) {"
    new2 = "    // （buildGateButtons）完全沒變。\n    endLoginGateBoot();\n    if (statusEl) {"
    if old2 in js:
        js = js.replace(old2, new2, 1)
        print("nologin short ok")
    else:
        print("WARN nologin pattern missing")

# Also add a safety timeout so boot never hangs forever if fetch hangs
if "loginGateBootSafety" not in js:
    old_start = "  async function initAuthGate() {\n    startLoginGateWeatherCycle();\n    showGateError();"
    new_start = (
        "  async function initAuthGate() {\n"
        "    startLoginGateWeatherCycle();\n"
        "    // 安全機制：最多 12 秒，避免 /api/auth/session 卡住時永遠轉圈\n"
        "    const loginGateBootSafety = setTimeout(() => {\n"
        "      try { endLoginGateBoot(); } catch (e) {}\n"
        "    }, 12000);\n"
        "    showGateError();"
    )
    if old_start in js:
        js = js.replace(old_start, new_start, 1)
        print("safety timer ok")
    # clear safety on endLoginGateBoot
    old_end = (
        "  function endLoginGateBoot() {\n"
        "    if (loginGateWeatherTimer) { clearInterval(loginGateWeatherTimer); loginGateWeatherTimer = null; }\n"
    )
    new_end = (
        "  function endLoginGateBoot() {\n"
        "    try { if (typeof loginGateBootSafety !== \"undefined\") clearTimeout(loginGateBootSafety); } catch (e) {}\n"
        "    if (loginGateWeatherTimer) { clearInterval(loginGateWeatherTimer); loginGateWeatherTimer = null; }\n"
    )
    # safety is local to initAuthGate - use a module-level var instead
    # Fix: use outer let
    pass

# Better safety with outer variable
if "let loginGateBootSafetyTimer" not in js:
    js = js.replace(
        "  let loginGateWeatherTimer = null;",
        "  let loginGateWeatherTimer = null;\n  let loginGateBootSafetyTimer = null;",
        1,
    )
    js = js.replace(
        "  function endLoginGateBoot() {\n    if (loginGateWeatherTimer) { clearInterval(loginGateWeatherTimer); loginGateWeatherTimer = null; }",
        "  function endLoginGateBoot() {\n    if (loginGateBootSafetyTimer) { clearTimeout(loginGateBootSafetyTimer); loginGateBootSafetyTimer = null; }\n    if (loginGateWeatherTimer) { clearInterval(loginGateWeatherTimer); loginGateWeatherTimer = null; }",
        1,
    )
    # Replace the local const safety if we added it - use outer
    if "const loginGateBootSafety = setTimeout" in js:
        js = js.replace(
            "    // 安全機制：最多 12 秒，避免 /api/auth/session 卡住時永遠轉圈\n"
            "    const loginGateBootSafety = setTimeout(() => {\n"
            "      try { endLoginGateBoot(); } catch (e) {}\n"
            "    }, 12000);\n",
            "    // 安全機制：最多 12 秒，避免 /api/auth/session 卡住時永遠轉圈\n"
            "    if (loginGateBootSafetyTimer) clearTimeout(loginGateBootSafetyTimer);\n"
            "    loginGateBootSafetyTimer = setTimeout(() => {\n"
            "      try { endLoginGateBoot(); } catch (e) {}\n"
            "    }, 12000);\n",
            1,
        )
    elif "loginGateBootSafetyTimer = setTimeout" not in js:
        js = js.replace(
            "  async function initAuthGate() {\n    startLoginGateWeatherCycle();\n    showGateError();",
            "  async function initAuthGate() {\n"
            "    startLoginGateWeatherCycle();\n"
            "    if (loginGateBootSafetyTimer) clearTimeout(loginGateBootSafetyTimer);\n"
            "    loginGateBootSafetyTimer = setTimeout(() => { try { endLoginGateBoot(); } catch (e) {} }, 12000);\n"
            "    showGateError();",
            1,
        )
    print("safety outer ok")

js_path.write_text(js, encoding="utf-8")
print("endLoginGateBoot count", js.count("endLoginGateBoot"))
print("DONE")
