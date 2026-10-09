#!/usr/bin/env python3
from pathlib import Path
import base64
import re
import urllib.request

Path("public/login-icons").mkdir(parents=True, exist_ok=True)
google_path = Path("public/login-icons/google.png")
if not google_path.exists() or google_path.stat().st_size < 500:
    urls = [
        "https://www.google.com/images/branding/googleg/1x/googleg_standard_color_48dp.png",
        "https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/google.svg",
    ]
    ok = False
    for u in urls:
        try:
            urllib.request.urlretrieve(u, google_path)
            if google_path.stat().st_size > 100:
                print("google icon from", u, google_path.stat().st_size)
                ok = True
                break
        except Exception as e:
            print("fail", u, e)
    if not ok:
        # minimal 1x1 fallback will break icon; leave missing
        print("WARN: could not download google icon")
else:
    print("google.png exists")

html = Path("public/index.html")
t = html.read_text(encoding="utf-8")
new_tag = (
    '<p class="login-gate-tagline login-gate-tagline--terminal" id="loginGateTagline" '
    'aria-label="掌控天後，連動生活">\n'
    '        <span class="login-gate-terminal-prefix" aria-hidden="true">&gt; </span>'
    '<span id="loginGateTaglineTyped" class="login-gate-tagline-typed"></span>'
    '<span class="login-gate-cursor login-gate-cursor--tagline" aria-hidden="true">' + chr(0x2588) + '</span>\n'
    '      </p>'
)
if "loginGateTaglineTyped" in t:
    print("html tagline already")
else:
    t2, n = re.subn(r'<p class="login-gate-tagline">[^<]*</p>', new_tag, t, count=1)
    if n != 1:
        raise SystemExit(f"tagline not found n={n}")
    html.write_text(t2, encoding="utf-8")
    print("html tagline ok")

css = Path("public/style.css")
c = css.read_text(encoding="utf-8")
if "LOGIN_TEXT_WHITE_TERMINAL" not in c:
    c += """

/* LOGIN_TEXT_WHITE_TERMINAL */
.login-gate-title--terminal,
.login-gate-title,
.login-gate-title-typed {
  color: #ffffff !important;
  text-shadow: 0 1px 12px rgba(0,0,0,0.45), 0 0 20px rgba(92, 225, 255, 0.25) !important;
}
.login-gate-tagline,
.login-gate-tagline--terminal,
.login-gate-tagline-typed {
  color: rgba(255, 255, 255, 0.92) !important;
  text-align: left !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
  font-size: 13.5px !important;
  letter-spacing: 0.06em !important;
  text-shadow: 0 1px 8px rgba(0,0,0,0.4) !important;
  margin-bottom: 28px !important;
}
.login-gate-terminal-prefix { color: #7ef0ff !important; }
.login-gate-cursor { color: #7ef0ff !important; }
.login-gate-more-toggle,
.login-gate-divider { color: rgba(255, 255, 255, 0.7) !important; }
.login-gate-divider::before,
.login-gate-divider::after {
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent) !important;
}
.login-gate .login-gate-terms,
.login-gate a { color: rgba(255, 255, 255, 0.85) !important; }
.login-gate-btn img,
.login-gate-btn svg {
  width: 18px !important;
  height: 18px !important;
  flex-shrink: 0;
  opacity: 1 !important;
}
"""
    css.write_text(c, encoding="utf-8")
    print("css ok")
else:
    print("css already")

js = Path("public/web-shim.js")
j = js.read_text(encoding="utf-8")
if 'google: "login-icons/google.png"' not in j:
    if "google: null" in j:
        j = j.replace('google: null, // 用內建 SVG（見下方），不用圖檔', 'google: "login-icons/google.png",', 1)
        print("js google path ok")
    else:
        j = j.replace("const PROVIDER_ICON = {", 'const PROVIDER_ICON = {\n    google: "login-icons/google.png",', 1)
        print("js google insert")

old_icon = 'const icon = p.id === "google" ? GOOGLE_SVG : `<img src="${PROVIDER_ICON[p.id]}" alt="" />`;'
new_icon = (
    'const icon = PROVIDER_ICON[p.id]\n'
    '          ? `<img src="${PROVIDER_ICON[p.id]}" alt="" width="18" height="18" />`\n'
    '          : (p.id === "google" ? GOOGLE_SVG : "");'
)
if old_icon in j:
    j = j.replace(old_icon, new_icon, 1)
    print("js buildGateButtons ok")
else:
    print("js buildGateButtons pattern miss")

if "LOGIN_TAGLINE_TYPE" not in j:
    j += """
/* LOGIN_TAGLINE_TYPE */
(function () {
  function typeText(el, text, delay, done) {
    if (!el) { if (done) done(); return; }
    if (el.dataset.typing === "1") return;
    el.dataset.typing = "1";
    var i = 0;
    el.textContent = "";
    function tick() {
      if (i <= text.length) {
        el.textContent = text.slice(0, i);
        i += 1;
        setTimeout(tick, 70);
      } else {
        el.dataset.typing = "0";
        el.dataset.done = "1";
        if (done) done();
      }
    }
    setTimeout(tick, delay || 0);
  }
  function runAll() {
    var gate = document.getElementById("loginGate");
    if (gate && gate.classList.contains("login-gate--booting")) return;
    var title = document.getElementById("loginGateTitleTyped");
    var tag = document.getElementById("loginGateTaglineTyped");
    if (title && title.dataset.done !== "1") {
      typeText(title, "MapSky", 200, function () {
        typeText(tag, "掌控天後，連動生活", 180);
      });
    } else if (tag && tag.dataset.done !== "1") {
      typeText(tag, "掌控天後，連動生活", 120);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", runAll);
  else runAll();
  var gate = document.getElementById("loginGate");
  if (gate) {
    new MutationObserver(function () {
      if (!gate.classList.contains("login-gate--booting")) runAll();
    }).observe(gate, { attributes: true, attributeFilter: ["class"] });
  }
})();
"""
    print("js tagline type ok")

js.write_text(j, encoding="utf-8")
print("DONE")
