#!/usr/bin/env python3
from pathlib import Path

# --- HTML ---
html_path = Path("public/index.html")
html = html_path.read_text(encoding="utf-8")
old_status = '<p id="loginGateStatus" class="login-gate-status">正在確認登入狀態…</p>'
new_status = (
    '<p id="loginGateStatus" class="login-gate-status login-gate-status--loading" '
    'role="status" aria-live="polite">'
    '<span class="login-gate-spinner" aria-hidden="true"></span>'
    '<span class="sr-only">正在確認登入狀態…</span>'
    '</p>'
)
if old_status in html:
    html = html.replace(old_status, new_status)
    html_path.write_text(html, encoding="utf-8")
    print("html ok")
elif "login-gate-spinner" in html:
    print("html already")
else:
    raise SystemExit("status element not found")

# --- CSS ---
css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")
if "login-gate-spinner" not in css:
    css += """
.login-gate-status--loading {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 36px;
  margin-bottom: 14px;
}
.login-gate-spinner {
  display: inline-block;
  width: 28px;
  height: 28px;
  border: 3px solid rgba(47, 111, 237, 0.18);
  border-top-color: #2f6fed;
  border-radius: 50%;
  animation: login-gate-spin 0.75s linear infinite;
}
@keyframes login-gate-spin {
  to { transform: rotate(360deg); }
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
"""
    css_path.write_text(css, encoding="utf-8")
    print("css ok")
else:
    print("css already")

# --- JS: when clearing/setting status text, drop loading class ---
js_path = Path("public/web-shim.js")
js = js_path.read_text(encoding="utf-8")
# After session check succeeds for logged-out: statusEl.textContent = ""
old_clear = "    if (statusEl) statusEl.textContent = \"\";\n    const primaryIds"
new_clear = (
    "    if (statusEl) {\n"
    "      statusEl.textContent = \"\";\n"
    "      statusEl.classList.remove(\"login-gate-status--loading\");\n"
    "    }\n"
    "    const primaryIds"
)
if old_clear in js:
    js = js.replace(old_clear, new_clear)
    print("js clear ok")
elif "login-gate-status--loading" in js:
    print("js already")
else:
    # still ok if not found - textContent clear removes spinner nodes
    print("js clear pattern skipped")

old_err = 'if (statusEl) statusEl.textContent = "無法連線到登入伺服器，請重新整理再試一次。";'
new_err = (
    "if (statusEl) {\n"
    "      statusEl.classList.remove(\"login-gate-status--loading\");\n"
    "      statusEl.textContent = \"無法連線到登入伺服器，請重新整理再試一次。\";\n"
    "    }"
)
if old_err in js:
    js = js.replace(old_err, new_err)
    print("js err ok")

js_path.write_text(js, encoding="utf-8")
print("DONE")
