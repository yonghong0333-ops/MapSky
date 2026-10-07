#!/usr/bin/env python3
from pathlib import Path
import re

JS = Path("public/web-shim.js")

NEW = r'''          if (resp.ok && data.ok) {
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
    pat = re.compile(
        r"if \(resp\.ok && data\.ok\) \{\s*"
        r"window\.location\.href = \"/\?login=success\";\s*"
        r"return;\s*"
        r"\}",
        re.M,
    )
    m = pat.search(js)
    if not m:
        raise SystemExit("OTP success block not found")
    js = js[: m.start()] + NEW.strip() + js[m.end() :]
    JS.write_text(js, encoding="utf-8")
    print("patched ok", JS.stat().st_size)


if __name__ == "__main__":
    main()
