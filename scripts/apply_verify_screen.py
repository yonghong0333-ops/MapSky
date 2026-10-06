#!/usr/bin/env python3
"""Add magic-link verification screen after email is sent."""
from pathlib import Path
import re

# ========== HTML ==========
html_path = Path("public/index.html")
html = html_path.read_text(encoding="utf-8")

verify_panel = '''
      <!-- 寄出 Magic Link 後切換到此畫面，引導使用者去查收信箱 -->
      <div id="loginGateVerifyPanel" class="login-gate-verify hidden">
        <div class="login-gate-verify-icon" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="3"/>
            <path d="M2 7l10 7 10-7"/>
          </svg>
        </div>
        <h2 class="login-gate-verify-title">請查收您的信箱</h2>
        <p class="login-gate-verify-desc">我們已把登入連結寄到</p>
        <p id="loginGateVerifyEmail" class="login-gate-verify-email"></p>
        <p class="login-gate-verify-hint">點開信件中的連結即可完成登入。<br/>若沒看到，請檢查垃圾郵件匣。</p>
        <button type="button" id="loginGateVerifyResend" class="login-gate-verify-resend" disabled>
          <span id="loginGateVerifyResendLabel">60 秒後可再寄送</span>
        </button>
        <button type="button" id="loginGateVerifyBack" class="login-gate-verify-back">使用其他登入方式</button>
      </div>
'''

marker = '<p id="loginGateMagicHint" class="login-gate-magic-hint hidden"></p>'
if marker not in html:
    raise SystemExit("magic hint marker not found")
if 'id="loginGateVerifyPanel"' in html:
    print("verify panel already present, skip HTML insert")
else:
    html = html.replace(marker, marker + "\n" + verify_panel)
    html_path.write_text(html, encoding="utf-8")
    print("html ok")

# ========== CSS ==========
css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")

css_block = '''
/* ---- Magic Link 寄出後的驗證畫面 ---- */
.login-gate-verify {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 8px 0 4px;
}
.login-gate-verify.hidden { display: none; }
.login-gate-verify-icon {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: rgba(47, 111, 237, 0.12);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}
.login-gate-verify-title {
  font-size: 20px;
  font-weight: 800;
  color: var(--text-main);
  margin: 0 0 8px;
}
.login-gate-verify-desc {
  font-size: 13.5px;
  color: var(--text-muted);
  margin: 0 0 4px;
}
.login-gate-verify-email {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-main);
  word-break: break-all;
  margin: 0 0 14px;
}
.login-gate-verify-hint {
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--text-faint);
  margin: 0 0 20px;
}
.login-gate-verify-resend {
  width: 100%;
  padding: 12px 16px;
  border-radius: 999px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, opacity 0.15s ease;
}
.login-gate-verify-resend:hover:not([disabled]) {
  background: var(--accent-hover);
}
.login-gate-verify-resend[disabled] {
  opacity: 0.55;
  cursor: default;
  background: rgba(47, 111, 237, 0.45);
  border-color: transparent;
}
.login-gate-verify-back {
  margin-top: 12px;
  padding: 8px 12px;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.login-gate-verify-back:hover {
  color: var(--accent);
}

/* 進入驗證畫面時，隱藏原本的登入選項區塊 */
.login-gate-card.is-verifying .login-gate-status,
.login-gate-card.is-verifying .login-gate-buttons,
.login-gate-card.is-verifying .login-gate-more-toggle,
.login-gate-card.is-verifying .login-gate-buttons-extra,
.login-gate-card.is-verifying .login-gate-divider,
.login-gate-card.is-verifying .login-gate-magic-form,
.login-gate-card.is-verifying .login-gate-magic-hint,
.login-gate-card.is-verifying .login-gate-error {
  display: none !important;
}
'''

if ".login-gate-verify {" in css:
    print("verify css already present, skip")
else:
    if "/* Sidebar */" in css:
        css = css.replace("/* Sidebar */", css_block + "\n/* Sidebar */")
    else:
        css += "\n" + css_block
    css_path.write_text(css, encoding="utf-8")
    print("css ok")

# ========== JS ==========
js_path = Path("public/web-shim.js")
js = js_path.read_text(encoding="utf-8")

ARROW = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'

if "showMagicLinkVerifyPanel" in js:
    print("verify JS already present, skip")
else:
    new_functions = (
        "  const MAGIC_LINK_COOLDOWN_SECONDS = 60;\n"
        "  let magicLinkCooldownTimer = null;\n"
        "  let magicLinkLastEmail = \"\";\n\n"
        "  function setMagicLinkHint(text, isError) {\n"
        "    const hintEl = el(\"loginGateMagicHint\");\n"
        "    if (!hintEl) return;\n"
        "    if (!text) {\n"
        "      hintEl.classList.add(\"hidden\");\n"
        "      hintEl.textContent = \"\";\n"
        "      return;\n"
        "    }\n"
        "    hintEl.textContent = text;\n"
        "    hintEl.classList.remove(\"hidden\");\n"
        "    hintEl.classList.toggle(\"login-gate-magic-hint-error\", Boolean(isError));\n"
        "  }\n\n"
        "  function setMagicSubmitIdle(submitBtn, labelEl) {\n"
        "    if (!submitBtn || !labelEl) return;\n"
        f"    labelEl.innerHTML = `{ARROW}`;\n"
        "    submitBtn.setAttribute(\"aria-label\", \"寄送登入連結\");\n"
        "    submitBtn.setAttribute(\"title\", \"寄送登入連結\");\n"
        "    submitBtn.disabled = false;\n"
        "  }\n\n"
        "  function startMagicLinkCooldown(onTick) {\n"
        "    let remaining = MAGIC_LINK_COOLDOWN_SECONDS;\n"
        "    if (magicLinkCooldownTimer) {\n"
        "      clearInterval(magicLinkCooldownTimer);\n"
        "      magicLinkCooldownTimer = null;\n"
        "    }\n"
        "    const tick = () => {\n"
        "      if (typeof onTick === \"function\") onTick(remaining);\n"
        "      if (remaining <= 0) {\n"
        "        clearInterval(magicLinkCooldownTimer);\n"
        "        magicLinkCooldownTimer = null;\n"
        "        return;\n"
        "      }\n"
        "      remaining -= 1;\n"
        "    };\n"
        "    tick();\n"
        "    magicLinkCooldownTimer = setInterval(tick, 1000);\n"
        "  }\n\n"
        "  function showMagicLinkVerifyPanel(email) {\n"
        "    const card = document.querySelector(\".login-gate-card\");\n"
        "    const panel = el(\"loginGateVerifyPanel\");\n"
        "    const emailEl = el(\"loginGateVerifyEmail\");\n"
        "    const resendBtn = el(\"loginGateVerifyResend\");\n"
        "    const resendLabel = el(\"loginGateVerifyResendLabel\");\n"
        "    if (!panel) return;\n\n"
        "    magicLinkLastEmail = email || magicLinkLastEmail;\n"
        "    if (emailEl) emailEl.textContent = magicLinkLastEmail;\n"
        "    if (card) card.classList.add(\"is-verifying\");\n"
        "    panel.classList.remove(\"hidden\");\n\n"
        "    if (resendBtn && resendLabel) {\n"
        "      resendBtn.disabled = true;\n"
        "      startMagicLinkCooldown((remaining) => {\n"
        "        if (remaining > 0) {\n"
        "          resendBtn.disabled = true;\n"
        "          resendLabel.textContent = `${remaining} 秒後可再寄送`;\n"
        "        } else {\n"
        "          resendBtn.disabled = false;\n"
        "          resendLabel.textContent = \"再寄一次登入連結\";\n"
        "        }\n"
        "      });\n"
        "    }\n"
        "  }\n\n"
        "  function hideMagicLinkVerifyPanel() {\n"
        "    const card = document.querySelector(\".login-gate-card\");\n"
        "    const panel = el(\"loginGateVerifyPanel\");\n"
        "    if (card) card.classList.remove(\"is-verifying\");\n"
        "    if (panel) panel.classList.add(\"hidden\");\n"
        "  }\n\n"
        "  async function sendMagicLink(email, { fromVerifyPanel } = {}) {\n"
        "    const submitBtn = el(\"loginGateMagicSubmit\");\n"
        "    const labelEl = el(\"loginGateMagicSubmitLabel\");\n"
        "    const resendBtn = el(\"loginGateVerifyResend\");\n"
        "    const resendLabel = el(\"loginGateVerifyResendLabel\");\n\n"
        "    if (submitBtn) submitBtn.disabled = true;\n"
        "    if (labelEl) {\n"
        "      labelEl.innerHTML = \"…\";\n"
        "      submitBtn.setAttribute(\"aria-label\", \"寄送中…\");\n"
        "      submitBtn.setAttribute(\"title\", \"寄送中…\");\n"
        "    }\n"
        "    if (fromVerifyPanel && resendBtn && resendLabel) {\n"
        "      resendBtn.disabled = true;\n"
        "      resendLabel.textContent = \"寄送中…\";\n"
        "    }\n"
        "    if (!fromVerifyPanel) setMagicLinkHint(\"\");\n\n"
        "    try {\n"
        "      const resp = await fetch(\"/api/auth/login?provider=email\", {\n"
        "        method: \"POST\",\n"
        "        headers: { \"Content-Type\": \"application/json\" },\n"
        "        body: JSON.stringify({ email }),\n"
        "      });\n"
        "      const data = await resp.json().catch(() => ({}));\n"
        "      if (resp.ok && data.ok) {\n"
        "        showMagicLinkVerifyPanel(email);\n"
        "        return true;\n"
        "      } else if (resp.status === 429) {\n"
        "        showMagicLinkVerifyPanel(email);\n"
        "        return true;\n"
        "      } else if (data.reason === \"invalid-email\") {\n"
        "        if (fromVerifyPanel) hideMagicLinkVerifyPanel();\n"
        "        setMagicLinkHint(\"這個 Email 格式怪怪的，請確認後再試一次。\", true);\n"
        "        setMagicSubmitIdle(submitBtn, labelEl);\n"
        "        return false;\n"
        "      } else {\n"
        "        if (fromVerifyPanel && resendBtn && resendLabel) {\n"
        "          resendBtn.disabled = false;\n"
        "          resendLabel.textContent = \"再寄一次登入連結\";\n"
        "        }\n"
        "        setMagicLinkHint(\"寄送失敗，請稍後再試一次。\", true);\n"
        "        setMagicSubmitIdle(submitBtn, labelEl);\n"
        "        return false;\n"
        "      }\n"
        "    } catch (err) {\n"
        "      if (fromVerifyPanel && resendBtn && resendLabel) {\n"
        "        resendBtn.disabled = false;\n"
        "        resendLabel.textContent = \"再寄一次登入連結\";\n"
        "      }\n"
        "      setMagicLinkHint(\"網路連線有問題，請稍後再試一次。\", true);\n"
        "      setMagicSubmitIdle(submitBtn, labelEl);\n"
        "      return false;\n"
        "    }\n"
        "  }\n\n"
        "  function initMagicLinkForm() {\n"
        "    const form = el(\"loginGateMagicForm\");\n"
        "    const emailInput = el(\"loginGateMagicEmail\");\n"
        "    const submitBtn = el(\"loginGateMagicSubmit\");\n"
        "    const labelEl = el(\"loginGateMagicSubmitLabel\");\n"
        "    const resendBtn = el(\"loginGateVerifyResend\");\n"
        "    const backBtn = el(\"loginGateVerifyBack\");\n"
        "    if (!form || !emailInput || !submitBtn || !labelEl || form.dataset.bound) return;\n"
        "    form.dataset.bound = \"1\";\n\n"
        "    form.addEventListener(\"submit\", async (e) => {\n"
        "      e.preventDefault();\n"
        "      if (submitBtn.disabled) return;\n"
        "      const email = emailInput.value.trim();\n"
        "      if (!email) return;\n"
        "      await sendMagicLink(email, { fromVerifyPanel: false });\n"
        "    });\n\n"
        "    if (resendBtn && !resendBtn.dataset.bound) {\n"
        "      resendBtn.dataset.bound = \"1\";\n"
        "      resendBtn.addEventListener(\"click\", async () => {\n"
        "        if (resendBtn.disabled) return;\n"
        "        const email = magicLinkLastEmail || (emailInput && emailInput.value.trim());\n"
        "        if (!email) return;\n"
        "        await sendMagicLink(email, { fromVerifyPanel: true });\n"
        "      });\n"
        "    }\n\n"
        "    if (backBtn && !backBtn.dataset.bound) {\n"
        "      backBtn.dataset.bound = \"1\";\n"
        "      backBtn.addEventListener(\"click\", () => {\n"
        "        if (magicLinkCooldownTimer) {\n"
        "          clearInterval(magicLinkCooldownTimer);\n"
        "          magicLinkCooldownTimer = null;\n"
        "        }\n"
        "        hideMagicLinkVerifyPanel();\n"
        "        setMagicSubmitIdle(submitBtn, labelEl);\n"
        "        setMagicLinkHint(\"\");\n"
        "      });\n"
        "    }\n"
        "  }\n\n"
    )

    start = js.find("  const MAGIC_LINK_COOLDOWN_SECONDS = 60;")
    if start < 0:
        raise SystemExit("MAGIC_LINK_COOLDOWN not found")
    end = js.find("  async function initAuthGate()")
    if end < 0:
        raise SystemExit("initAuthGate not found")
    js = js[:start] + new_functions + js[end:]
    js_path.write_text(js, encoding="utf-8")
    print("js ok")

print("ALL DONE")
