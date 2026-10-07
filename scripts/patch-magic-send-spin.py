#!/usr/bin/env python3
from pathlib import Path

JS = Path("public/web-shim.js")
CSS = Path("public/style.css")

SPIN_SVG = (
    '<svg class="login-gate-magic-spin" width="18" height="18" viewBox="0 0 24 24" '
    'fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">'
    '<circle cx="12" cy="12" r="9" opacity="0.25"/>'
    '<path d="M21 12a9 9 0 0 0-9-9"/>'
    "</svg>"
)

ARROW_SVG = (
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M12 19V5M5 12l7-7 7 7"/></svg>'
)


def patch_js():
    js = JS.read_text(encoding="utf-8")
    if "login-gate-magic-spin" in js:
        print("JS already patched")
        return

    old_sending = '''if (labelEl) {
      labelEl.innerHTML = "…";
      submitBtn.setAttribute("aria-label", "寄送中…");
      submitBtn.setAttribute("title", "寄送中…");
    }'''
    new_sending = f'''if (submitBtn) submitBtn.classList.add("is-sending");
    if (labelEl) {{
      labelEl.innerHTML = `{SPIN_SVG}`;
      submitBtn.setAttribute("aria-label", "寄送中…");
      submitBtn.setAttribute("title", "寄送中…");
    }}'''
    if old_sending not in js:
        raise SystemExit("sending block not found")
    js = js.replace(old_sending, new_sending, 1)

    old_idle = '''function setMagicSubmitIdle(submitBtn, labelEl) {
    if (!submitBtn || !labelEl) return;
    labelEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;
    submitBtn.setAttribute("aria-label", "寄送登入連結");
    submitBtn.setAttribute("title", "寄送登入連結");
    submitBtn.disabled = false;
  }'''
    new_idle = f'''function setMagicSubmitIdle(submitBtn, labelEl) {{
    if (!submitBtn || !labelEl) return;
    submitBtn.classList.remove("is-sending");
    labelEl.innerHTML = `{ARROW_SVG}`;
    submitBtn.setAttribute("aria-label", "寄送登入連結");
    submitBtn.setAttribute("title", "寄送登入連結");
    submitBtn.disabled = false;
  }}'''
    if old_idle not in js:
        raise SystemExit("setMagicSubmitIdle not found")
    js = js.replace(old_idle, new_idle, 1)

    JS.write_text(js, encoding="utf-8")
    print("patched web-shim.js")


def patch_css():
    css = CSS.read_text(encoding="utf-8")
    marker = "/* MAGIC_SEND_SPIN */"
    if marker in css:
        print("CSS already has spin")
        return
    block = '''

/* MAGIC_SEND_SPIN */
.login-gate-magic-submit.is-sending {
  background: var(--accent) !important;
  opacity: 1 !important;
  pointer-events: none;
}
.login-gate-magic-submit.is-sending .login-gate-magic-submit-icon,
.login-gate-magic-submit.is-sending .login-gate-magic-spin {
  animation: magicSendSpin 0.75s linear infinite;
}
@keyframes magicSendSpin {
  to { transform: rotate(360deg); }
}
'''
    CSS.write_text(css.rstrip() + block, encoding="utf-8")
    print("patched style.css")


if __name__ == "__main__":
    patch_js()
    patch_css()
