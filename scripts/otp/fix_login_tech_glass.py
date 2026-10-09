#!/usr/bin/env python3
from pathlib import Path

css_path = Path("public/style.css")
css = css_path.read_text(encoding="utf-8")

if "LOGIN_TECH_GLASS_V2" in css:
    print("already")
else:
    css += '''

/* LOGIN_TECH_GLASS_V2 — 登入卡科技玻璃 */
.login-gate {
  --login-cyan: #5ce1ff;
  --login-line: rgba(92, 225, 255, 0.35);
}
.login-gate-card {
  position: relative;
  width: min(100%, 380px);
  padding: 36px 26px 28px;
  border-radius: 26px;
  background:
    linear-gradient(155deg,
      rgba(255, 255, 255, 0.38) 0%,
      rgba(230, 242, 255, 0.22) 45%,
      rgba(255, 255, 255, 0.28) 100%);
  border: 1px solid var(--login-line);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.25) inset,
    0 1px 0 rgba(255, 255, 255, 0.55) inset,
    0 20px 50px rgba(20, 50, 110, 0.18),
    0 0 40px rgba(92, 225, 255, 0.08);
  backdrop-filter: blur(32px) saturate(190%);
  -webkit-backdrop-filter: blur(32px) saturate(190%);
  overflow: hidden;
}
/* 角落科技框線 */
.login-gate-card::before {
  content: "";
  position: absolute;
  inset: 10px;
  border-radius: 18px;
  border: 1px solid rgba(92, 225, 255, 0.12);
  pointer-events: none;
  mask-image:
    linear-gradient(#000, #000) top / 100% 12px no-repeat,
    linear-gradient(#000, #000) bottom / 100% 12px no-repeat,
    linear-gradient(#000, #000) left / 12px 100% no-repeat,
    linear-gradient(#000, #000) right / 12px 100% no-repeat;
  -webkit-mask-image:
    linear-gradient(#000, #000) top / 100% 12px no-repeat,
    linear-gradient(#000, #000) bottom / 100% 12px no-repeat,
    linear-gradient(#000, #000) left / 12px 100% no-repeat,
    linear-gradient(#000, #000) right / 12px 100% no-repeat;
}
/* 頂部掃光 */
.login-gate-card::after {
  content: "";
  position: absolute;
  left: -30%;
  top: 0;
  width: 60%;
  height: 40%;
  background: linear-gradient(
    115deg,
    transparent 0%,
    rgba(255, 255, 255, 0.18) 45%,
    rgba(92, 225, 255, 0.12) 55%,
    transparent 100%
  );
  pointer-events: none;
  animation: login-card-sheen 6s ease-in-out infinite;
}
@keyframes login-card-sheen {
  0%, 100% { transform: translateX(0); opacity: 0.5; }
  50% { transform: translateX(80%); opacity: 0.85; }
}
.login-gate-logo {
  width: 68px;
  height: 68px;
  border-radius: 18px;
  margin: 0 auto 16px;
  display: block;
  position: relative;
  z-index: 1;
  box-shadow:
    0 10px 28px rgba(47, 111, 237, 0.28),
    0 0 20px rgba(92, 225, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.45);
}
.login-gate-title {
  position: relative;
  z-index: 1;
  margin: 0 0 6px;
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-align: center;
  color: #0f2744;
  text-shadow: 0 0 24px rgba(92, 225, 255, 0.25);
}
.login-gate-tagline {
  position: relative;
  z-index: 1;
  margin: 0 0 26px;
  text-align: center;
  font-size: 13px;
  letter-spacing: 0.06em;
  color: rgba(15, 39, 68, 0.58);
}
.login-gate-buttons {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.login-gate-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  border-radius: 999px;
  border: 1px solid rgba(92, 225, 255, 0.28);
  background:
    linear-gradient(160deg, rgba(255, 255, 255, 0.72) 0%, rgba(255, 255, 255, 0.4) 100%);
  color: #0f2744;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.02em;
  box-shadow:
    0 6px 18px rgba(20, 50, 100, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
  transition: transform 0.2s cubic-bezier(0.34, 1.4, 0.64, 1), box-shadow 0.2s ease, border-color 0.2s ease;
}
.login-gate-btn[data-provider="google"] {
  border-color: rgba(66, 133, 244, 0.45);
  box-shadow:
    0 8px 22px rgba(66, 133, 244, 0.2),
    0 0 16px rgba(92, 225, 255, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.85);
}
.login-gate-btn:hover,
.login-gate-btn:focus-visible {
  border-color: rgba(92, 225, 255, 0.55);
  box-shadow:
    0 8px 24px rgba(47, 111, 237, 0.16),
    0 0 20px rgba(92, 225, 255, 0.18);
}
.login-gate-btn:active {
  transform: scale(0.97);
}
.login-gate-more-toggle {
  position: relative;
  z-index: 1;
  margin: 14px 0 2px;
  color: rgba(15, 39, 68, 0.5);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
}
.login-gate-divider {
  position: relative;
  z-index: 1;
  margin: 18px 0 16px;
  color: rgba(15, 39, 68, 0.4);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
}
.login-gate-divider::before,
.login-gate-divider::after {
  background: linear-gradient(90deg, transparent, rgba(92, 225, 255, 0.45), transparent);
  height: 1px;
}
.login-gate-magic-form {
  position: relative;
  z-index: 1;
}
.login-gate-magic-row {
  display: flex;
  align-items: center;
  gap: 0;
  background:
    linear-gradient(160deg, rgba(255, 255, 255, 0.65) 0%, rgba(255, 255, 255, 0.35) 100%);
  border: 1px solid rgba(92, 225, 255, 0.32);
  border-radius: 999px;
  padding: 4px 4px 4px 16px;
  box-shadow:
    0 6px 18px rgba(20, 50, 100, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.login-gate-magic-input {
  flex: 1;
  border: none;
  background: transparent;
  padding: 12px 8px;
  font-size: 15px;
  outline: none;
  color: #0f2744;
  letter-spacing: 0.02em;
}
.login-gate-magic-input::placeholder {
  color: rgba(15, 39, 68, 0.4);
}
.login-gate-magic-submit {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: linear-gradient(145deg, #5b9cf5 0%, #2f6fed 55%, #1e4fc4 100%);
  color: #fff;
  box-shadow:
    0 4px 14px rgba(47, 111, 237, 0.4),
    0 0 16px rgba(92, 225, 255, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: transform 0.2s cubic-bezier(0.34, 1.4, 0.64, 1), box-shadow 0.2s ease;
}
.login-gate-magic-submit:active {
  transform: scale(0.92);
}
.login-gate a,
.login-gate .login-gate-terms {
  position: relative;
  z-index: 1;
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .login-gate-card {
    background: rgba(255, 255, 255, 0.88);
  }
  .login-gate-btn {
    background: #fff;
  }
}
'''
    css_path.write_text(css, encoding="utf-8")
    print("ok")
print("DONE")
