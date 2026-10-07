#!/usr/bin/env python3
from pathlib import Path

IDX = Path("public/index.html")

MARKER = "<!-- CRITICAL_BOOT_CSS -->"

CRITICAL = '''<!-- CRITICAL_BOOT_CSS -->
<style id="critical-boot-css">
  /* First paint: same blue sky + spinner as login gate (no white flash) */
  html, body {
    margin: 0;
    min-height: 100%;
    background: linear-gradient(180deg, #5b9cf5 0%, #7eb6f7 42%, #c5e0fc 100%) !important;
    background-color: #7eb6f7 !important;
  }
  body:not(.auth-ok) #appMain,
  body:not(.auth-ok) .app-shell,
  body:not(.auth-ok) main {
    visibility: hidden;
  }
  .login-gate.login-gate--booting {
    position: fixed !important;
    inset: 0 !important;
    z-index: 99999 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    background: linear-gradient(180deg, #5b9cf5 0%, #7eb6f7 42%, #c5e0fc 100%) !important;
    margin: 0 !important;
  }
  .login-gate-boot {
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 22px !important;
    color: rgba(30, 58, 95, 0.85) !important;
    font-family: -apple-system, "Segoe UI", "Noto Sans TC", sans-serif !important;
    font-size: 15px !important;
    font-weight: 600 !important;
  }
  .login-gate-boot-orbit-wrap {
    position: relative !important;
    width: 88px !important;
    height: 88px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
  }
  .login-gate-boot-orbit-ring {
    position: absolute !important;
    inset: 0 !important;
    border-radius: 50% !important;
    border: 3px solid rgba(255, 255, 255, 0.4) !important;
    border-top-color: #3b82f6 !important;
    animation: criticalBootSpin 0.85s linear infinite !important;
  }
  @keyframes criticalBootSpin {
    to { transform: rotate(360deg); }
  }
</style>
'''


def main():
    h = IDX.read_text(encoding="utf-8")
    if MARKER in h:
        print("already has critical boot css")
        return
    needle = '<link rel="stylesheet" href="style.css" />'
    if needle not in h:
        raise SystemExit("style.css link not found")
    h = h.replace(needle, CRITICAL + needle, 1)
    IDX.write_text(h, encoding="utf-8")
    print("patched index.html")


if __name__ == "__main__":
    main()
