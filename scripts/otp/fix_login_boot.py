#!/usr/bin/env python3
from pathlib import Path

# --- HTML: add full-screen boot overlay, mark gate as booting ---
html_path = Path("public/index.html")
html = html_path.read_text(encoding="utf-8")

if 'id="loginGateBoot"' not in html:
    old_gate = '<div id="loginGate" class="login-gate">'
    new_gate = (
        '<div id="loginGate" class="login-gate login-gate--booting">\n'
        '    <div id="loginGateBoot" class="login-gate-boot" role="status" aria-live="polite">\n'
        '      <div class="login-gate-boot-orbit" aria-hidden="true">\n'
        '        <span class="login-gate-boot-ring"></span>\n'
        '        <span class="login-gate-boot-ring login-gate-boot-ring--delay"></span>\n'
        '        <img class="login-gate-boot-logo" src="icons/logo-dark.png" alt="" />\n'
        '      </div>\n'
        '      <p class="login-gate-boot-text">正在確認登入狀態…</p>\n'
        '    </div>'
    )
    if old_gate not in html:
        raise SystemExit("loginGate not found")
    html = html.replace(old_gate, new_gate, 1)
    html_path.write_text(html, encoding="utf-8")
    print("html ok")
else:
    print("html already")

# --- CSS ---
css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")
if "login-gate-boot-orbit" not in css:
    css += """
/* Full-screen boot animation while checking session */
.login-gate--booting .login-gate-card {
  visibility: hidden;
  pointer-events: none;
  opacity: 0;
}
.login-gate-boot {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  pointer-events: none;
}
.login-gate-boot.hidden {
  display: none;
}
.login-gate-boot-orbit {
  position: relative;
  width: 96px;
  height: 96px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.login-gate-boot-logo {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  object-fit: contain;
  animation: login-boot-pulse 1.6s ease-in-out infinite;
  position: relative;
  z-index: 1;
}
.login-gate-boot-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2.5px solid transparent;
  border-top-color: #2f6fed;
  border-right-color: rgba(47, 111, 237, 0.35);
  animation: login-boot-spin 1.1s linear infinite;
}
.login-gate-boot-ring--delay {
  inset: 10px;
  border-top-color: rgba(47, 111, 237, 0.55);
  border-right-color: transparent;
  border-bottom-color: rgba(47, 111, 237, 0.25);
  animation-duration: 1.6s;
  animation-direction: reverse;
}
.login-gate-boot-text {
  margin-top: 22px;
  font-size: 14px;
  font-weight: 500;
  color: rgba(31, 41, 55, 0.55);
  letter-spacing: 0.02em;
}
@keyframes login-boot-spin {
  to { transform: rotate(360deg); }
}
@keyframes login-boot-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(0.94); opacity: 0.85; }
}
"""
    css_path.write_text(css, encoding="utf-8")
    print("css ok")
else:
    print("css already")

# --- JS: end boot overlay when session check finishes ---
js_path = Path("public/web-shim.js")
js = js_path.read_text(encoding="utf-8")

if "function endLoginGateBoot" not in js:
    # Insert helper before initAuthGate
    marker = "  async function initAuthGate() {"
    helper = (
        "  function endLoginGateBoot() {\n"
        "    const gate = el(\"loginGate\");\n"
        "    const boot = el(\"loginGateBoot\");\n"
        "    if (gate) gate.classList.remove(\"login-gate--booting\");\n"
        "    if (boot) boot.classList.add(\"hidden\");\n"
        "  }\n\n"
        "  async function initAuthGate() {"
    )
    if marker not in js:
        raise SystemExit("initAuthGate not found")
    js = js.replace(marker, helper, 1)
    print("js helper ok")

# After error connecting
old_err = (
    "    } catch {\n"
    "      if (statusEl) statusEl.textContent = \"無法連線到登入伺服器，請重新整理再試一次。\";\n"
    "      return;\n"
    "    }"
)
# May already have classList remove from previous patch
if "無法連線到登入伺服器" in js and "endLoginGateBoot" not in js.split("無法連線到登入伺服器")[1][:200]:
    # Patch various error patterns
    for pattern in [
        (
            'if (statusEl) statusEl.textContent = "無法連線到登入伺服器，請重新整理再試一次。";\n      return;',
            'endLoginGateBoot();\n      if (statusEl) { statusEl.classList.remove("login-gate-status--loading"); statusEl.textContent = "無法連線到登入伺服器，請重新整理再試一次。"; }\n      return;',
        ),
        (
            'if (statusEl) {\n      statusEl.classList.remove("login-gate-status--loading");\n      statusEl.textContent = "無法連線到登入伺服器，請重新整理再試一次。";\n    }\n      return;',
            'endLoginGateBoot();\n      if (statusEl) {\n      statusEl.classList.remove("login-gate-status--loading");\n      statusEl.textContent = "無法連線到登入伺服器，請重新整理再試一次。";\n    }\n      return;',
        ),
    ]:
        if pattern[0] in js:
            js = js.replace(pattern[0], pattern[1])
            print("js err ok")
            break

# When logged in - before startAppAfterLogin / return
if "endLoginGateBoot()" not in js or js.count("endLoginGateBoot()") < 2:
    # Before: if (session.loggedIn) {
    old_logged = "    if (session.loggedIn) {\n      document.body.classList.add(\"auth-ok\");"
    new_logged = (
        "    if (session.loggedIn) {\n"
        "      endLoginGateBoot();\n"
        "      document.body.classList.add(\"auth-ok\");"
    )
    if old_logged in js:
        js = js.replace(old_logged, new_logged, 1)
        print("js logged-in ok")

    # Before showing login buttons (not logged in)
    old_out = "    // 未登入：把主畫面繼續擋著"
    # find the clear status near end
    old_clear = "    if (statusEl) statusEl.textContent = \"\";\n    const primaryIds"
    new_clear = (
        "    endLoginGateBoot();\n"
        "    if (statusEl) {\n"
        "      statusEl.textContent = \"\";\n"
        "      statusEl.classList.remove(\"login-gate-status--loading\");\n"
        "    }\n"
        "    const primaryIds"
    )
    old_clear2 = (
        "    if (statusEl) {\n"
        "      statusEl.textContent = \"\";\n"
        "      statusEl.classList.remove(\"login-gate-status--loading\");\n"
        "    }\n"
        "    const primaryIds"
    )
    if old_clear2 in js and "endLoginGateBoot();\n    if (statusEl)" not in js:
        js = js.replace(old_clear2, "    endLoginGateBoot();\n" + old_clear2, 1)
        print("js clear2 ok")
    elif old_clear in js:
        js = js.replace(old_clear, new_clear, 1)
        print("js clear ok")

    # maintenance mode also ends boot
    old_maint = "    if (session.maintenanceMode && !isAdminUser) {\n      showMaintenanceScreen(session, providers);\n      return;\n    }"
    new_maint = (
        "    if (session.maintenanceMode && !isAdminUser) {\n"
        "      endLoginGateBoot();\n"
        "      showMaintenanceScreen(session, providers);\n"
        "      return;\n"
        "    }"
    )
    if old_maint in js:
        js = js.replace(old_maint, new_maint, 1)
        print("js maint ok")

js_path.write_text(js, encoding="utf-8")
print("DONE", "endLoginGateBoot count", js.count("endLoginGateBoot"))
