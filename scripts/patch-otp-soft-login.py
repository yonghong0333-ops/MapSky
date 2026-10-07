#!/usr/bin/env python3
"""After OTP verify success, avoid full page reload (can flash offline in WebView)."""
from pathlib import Path
import re

JS = Path("public/web-shim.js")

OLD = '''          if (resp.ok && data.ok) {
            window.location.href = "/?login=success";
            return;
          }'''

NEW = '''          if (resp.ok && data.ok) {
            // Soft login: full reload can briefly show a false offline screen
            // in the native WebView / mobile browser. Stay on this page, mark
            // auth-ok, start renderer, then refresh session UI.
            if (data.xchg) {
              try {
                window.location.href = "mapsky://login-complete?xchg=" + encodeURIComponent(data.xchg);
              } catch (z) {}
            }
            try {
              hideMagicLinkVerifyPanel();
              const gate = el("loginGate");
              if (gate) {
                gate.classList.add("login-gate--booting");
                gate.classList.remove("hidden");
              }
              setLoginGateBootText("載入天氣與相關資訊中…");
              document.body.classList.add("auth-ok");
              window.__mapskyOnWeatherDataReady = function () {
                window.__mapskyOnWeatherDataReady = null;
                endLoginGateBoot();
              };
              if (loginGateBootSafetyTimer) clearTimeout(loginGateBootSafetyTimer);
              loginGateBootSafetyTimer = setTimeout(function () {
                try { endLoginGateBoot(); } catch (e) {}
              }, 30000);
              startAppAfterLogin();
              // Build account UI from a fresh session (cookie already set by verify response)
              loadSession().then(function (session) {
                if (!session || !session.loggedIn) {
                  window.location.replace("/?login=success");
                  return;
                }
                if (!session.profile.onboarded) showOnboarding(session);
                const slot = el("settingsAccountSlot");
                if (slot) {
                  slot.innerHTML = "";
                  slot.appendChild(buildUserBar(session));
                  slot.appendChild(buildProfileEditEntry(session));
                  slot.appendChild(buildPushNotificationEntry(session));
                  maybeAutoPromptPush(session);
                  startDesktopAnnouncements();
                  applySettingsAvatarIcon(currentAvatarSrc(session));
                }
                if (session.isAdmin) {
                  const adminBtn = el("adminBottomBtn");
                  if (adminBtn) adminBtn.classList.remove("hidden");
                  const adminTabBtn = el("adminTabBtn");
                  if (adminTabBtn) adminTabBtn.classList.remove("hidden");
                }
                window.__mapskyAdventureSkip = Boolean(session.adventureSkip);
              }).catch(function () {
                window.location.replace("/?login=success");
              });
            } catch (softErr) {
              window.location.replace("/?login=success");
            }
            return;
          }'''


def main():
    js = JS.read_text(encoding="utf-8")
    if "Soft login: full reload can briefly show" in js:
        print("already patched")
        return
    if OLD not in js:
        # tolerant fallback
        pat = re.compile(
            r"if \(resp\.ok && data\.ok\) \{\s*"
            r"window\.location\.href = \"/\?login=success\";\s*"
            r"return;\s*"
            r"\}",
            re.M,
        )
        if not pat.search(js):
            raise SystemExit("OTP success block not found")
        js = pat.sub(NEW.strip().split("if (resp.ok")[0] + "if (resp.ok" + NEW.split("if (resp.ok", 1)[1] if False else NEW.strip(), js, count=1)
        # simpler:
        js = JS.read_text(encoding="utf-8")
        m = pat.search(js)
        js = js[: m.start()] + NEW.strip() + js[m.end() :]
    else:
        js = js.replace(OLD, NEW, 1)
    JS.write_text(js, encoding="utf-8")
    print("patched", "Soft login" in JS.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
