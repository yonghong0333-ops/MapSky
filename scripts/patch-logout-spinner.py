#!/usr/bin/env python3
from pathlib import Path

JS = Path("public/web-shim.js")

OLD = '''        if (logoutBtn) {
          logoutBtn.addEventListener("click", async () => {
            await fetch("/api/auth/session?action=logout", { method: "POST" });
            window.location.href = "/";
          });
        }'''

NEW = '''        if (logoutBtn) {
          logoutBtn.addEventListener("click", async () => {
            // Instant feedback: avoid 1s blank app shell while logout request runs
            try {
              document.body.classList.remove("auth-ok");
              const gate = el("loginGate");
              if (gate) {
                gate.classList.remove("hidden");
                gate.classList.add("login-gate--booting");
              }
              const boot = el("loginGateBoot");
              if (boot) boot.classList.remove("hidden");
              setLoginGateBootText("正在登出…");
            } catch (e) {}
            try {
              await fetch("/api/auth/session?action=logout", {
                method: "POST",
                credentials: "same-origin",
              });
            } catch (e) {}
            window.location.replace("/");
          });
        }'''


def main():
    js = JS.read_text(encoding="utf-8")
    if "正在登出…" in js:
        print("already patched")
        return
    if OLD not in js:
        raise SystemExit("logout block not found")
    JS.write_text(js.replace(OLD, NEW, 1), encoding="utf-8")
    print("patched")


if __name__ == "__main__":
    main()
