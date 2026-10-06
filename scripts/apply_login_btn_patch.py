#!/usr/bin/env python3
from pathlib import Path
import re

ARROW = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'

# --- HTML ---
html = Path("public/index.html").read_text(encoding="utf-8")
html2, n = re.subn(
    r'<form id="loginGateMagicForm" class="login-gate-magic-form">.*?</form>',
    f'''<form id="loginGateMagicForm" class="login-gate-magic-form">
        <div class="login-gate-magic-row">
          <input
            type="email"
            id="loginGateMagicEmail"
            class="login-gate-magic-input"
            placeholder="輸入 Email 取得登入連結"
            autocomplete="email"
            inputmode="email"
            required
          />
          <button type="submit" id="loginGateMagicSubmit" class="login-gate-magic-submit" aria-label="寄送登入連結" title="寄送登入連結">
            <span id="loginGateMagicSubmitLabel" class="login-gate-magic-submit-icon" aria-hidden="true">
              {ARROW}
            </span>
          </button>
        </div>
      </form>''',
    html,
    count=1,
    flags=re.S,
)
assert n == 1, f"html form not replaced (n={n})"
Path("public/index.html").write_text(html2, encoding="utf-8")
print("html ok")

# --- CSS ---
css = Path("public/style.css").read_text(encoding="utf-8")
old = """.login-gate-magic-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.login-gate-magic-input {
  width: 100%;
  padding: 12px 16px;
  border-radius: 999px;
  border: 1px solid var(--input-border);
  background: var(--input-bg);
  color: var(--text-main);
  font-size: 14px;
  box-sizing: border-box;
}
.login-gate-magic-input:focus {
  outline: none;
  border-color: var(--accent);
}
.login-gate-magic-submit {
  width: 100%;
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  font-weight: 700;
}
.login-gate-magic-submit::after { border-color: rgba(255, 255, 255, 0.85); }
.login-gate-magic-submit:hover { background: var(--accent-hover); }
.login-gate-magic-submit[disabled] {
  opacity: 0.7;
  cursor: default;
  transform: none;
}"""
new = """.login-gate-magic-form {
  display: block;
}
.login-gate-magic-row {
  position: relative;
  display: flex;
  align-items: center;
}
.login-gate-magic-input {
  width: 100%;
  padding: 12px 48px 12px 16px;
  border-radius: 999px;
  border: 1px solid var(--input-border);
  background: var(--input-bg);
  color: var(--text-main);
  font-size: 14px;
  box-sizing: border-box;
}
.login-gate-magic-input:focus {
  outline: none;
  border-color: var(--accent);
}
.login-gate-magic-submit {
  position: absolute;
  right: 5px;
  top: 50%;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  padding: 0;
  margin: 0;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(20, 45, 95, 0.18);
  transition: background 0.15s ease, transform 0.1s ease, opacity 0.15s ease;
  flex-shrink: 0;
}
.login-gate-magic-submit:hover {
  background: var(--accent-hover);
  transform: translateY(-50%) scale(1.05);
}
.login-gate-magic-submit:active {
  transform: translateY(-50%) scale(0.96);
}
.login-gate-magic-submit[disabled] {
  opacity: 0.65;
  cursor: default;
  pointer-events: none;
  transform: translateY(-50%);
}
.login-gate-magic-submit-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
  font-size: 13px;
  font-weight: 700;
}
.login-gate-magic-submit-icon svg {
  display: block;
}"""
assert old in css, "css block not found"
Path("public/style.css").write_text(css.replace(old, new), encoding="utf-8")
print("css ok")

# --- JS ---
js = Path("public/web-shim.js").read_text(encoding="utf-8")
js = js.replace(
    "labelEl.textContent = `${remaining} 秒後可再寄送`;",
    f'labelEl.innerHTML = remaining > 0 ? String(remaining) : `{ARROW}`;\n'
    f'      submitBtn.setAttribute("aria-label", remaining > 0 ? `${{remaining}} 秒後可再寄送` : "寄送登入連結");\n'
    f'      submitBtn.setAttribute("title", remaining > 0 ? `${{remaining}} 秒後可再寄送` : "寄送登入連結");',
)
js = js.replace(
    'labelEl.textContent = "寄送登入連結";',
    f'labelEl.innerHTML = `{ARROW}`;\n'
    f'        submitBtn.setAttribute("aria-label", "寄送登入連結");\n'
    f'        submitBtn.setAttribute("title", "寄送登入連結");',
)
js = js.replace(
    'labelEl.textContent = "寄送中…";',
    f'labelEl.innerHTML = "…";\n'
    f'      submitBtn.setAttribute("aria-label", "寄送中…");\n'
    f'      submitBtn.setAttribute("title", "寄送中…");',
)
Path("public/web-shim.js").write_text(js, encoding="utf-8")
print("js ok")
print("ALL DONE")
