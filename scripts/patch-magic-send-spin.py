#!/usr/bin/env python3
from pathlib import Path
import re

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

    # Replace the "…" loading label inside sendMagicLink
    pat_send = re.compile(
        r"(async function sendMagicLink[\s\S]*?if \(submitBtn\) submitBtn\.disabled = true;\s*"
        r"if \(labelEl\) \{)\s*"
        r"labelEl\.innerHTML = \"[^\"]*\";\s*"
        r"submitBtn\.setAttribute\(\"aria-label\", \"[^\"]*\"\);\s*"
        r"submitBtn\.setAttribute\(\"title\", \"[^\"]*\"\);\s*"
        r"(\})",
        re.M,
    )
    m = pat_send.search(js)
    if not m:
        raise SystemExit("sendMagicLink loading block not found")
    repl = (
        m.group(1)
        + "\n      submitBtn.classList.add(\"is-sending\");\n"
        + f"      labelEl.innerHTML = `{SPIN_SVG}`;\n"
        + '      submitBtn.setAttribute("aria-label", "\u5bc4\u9001\u4e2d\u2026");\n'
        + '      submitBtn.setAttribute("title", "\u5bc4\u9001\u4e2d\u2026");\n    '
        + m.group(2)
    )
    # Use unicode chars properly
    repl = (
        m.group(1)
        + "\n      submitBtn.classList.add(\"is-sending\");\n"
        + f"      labelEl.innerHTML = `{SPIN_SVG}`;\n"
        + "      submitBtn.setAttribute(\"aria-label\", \"\u5bc4\u9001\u4e2d\u2026\");\n"
        + "      submitBtn.setAttribute(\"title\", \"\u5bc4\u9001\u4e2d\u2026\");\n    "
        + m.group(2)
    )
    repl = (
        m.group(1)
        + "\n      submitBtn.classList.add(\"is-sending\");\n"
        + f"      labelEl.innerHTML = `{SPIN_SVG}`;\n"
        + "      submitBtn.setAttribute(\"aria-label\", \"寄送中…\");\n"
        + "      submitBtn.setAttribute(\"title\", \"寄送中…\");\n    "
        + m.group(2)
    )
    js = pat_send.sub(repl, js, count=1)

    # setMagicSubmitIdle: restore arrow + clear is-sending
    pat_idle = re.compile(
        r"function setMagicSubmitIdle\(submitBtn, labelEl\) \{\s*"
        r"if \(!submitBtn \|\| !labelEl\) return;\s*"
        r"labelEl\.innerHTML = `[^`]+`;\s*"
        r"submitBtn\.setAttribute\(\"aria-label\", \"[^\"]*\"\);\s*"
        r"submitBtn\.setAttribute\(\"title\", \"[^\"]*\"\);\s*"
        r"submitBtn\.disabled = false;\s*"
        r"\}",
        re.M,
    )
    if not pat_idle.search(js):
        raise SystemExit("setMagicSubmitIdle not found")
    new_idle = (
        "function setMagicSubmitIdle(submitBtn, labelEl) {\n"
        "    if (!submitBtn || !labelEl) return;\n"
        "    submitBtn.classList.remove(\"is-sending\");\n"
        f"    labelEl.innerHTML = `{ARROW_SVG}`;\n"
        "    submitBtn.setAttribute(\"aria-label\", \"寄送登入連結\");\n"
        "    submitBtn.setAttribute(\"title\", \"寄送登入連結\");\n"
        "    submitBtn.disabled = false;\n"
        "  }"
    )
    js = pat_idle.sub(new_idle, js, count=1)

    JS.write_text(js, encoding="utf-8")
    print("patched web-shim.js", "spin" in js)


def patch_css():
    css = CSS.read_text(encoding="utf-8")
    marker = "/* MAGIC_SEND_SPIN */"
    if marker in css:
        print("CSS already has spin")
        return
    block = """

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
"""
    CSS.write_text(css.rstrip() + block, encoding="utf-8")
    print("patched style.css")


if __name__ == "__main__":
    patch_js()
    patch_css()
