logoutBtn.addEventListener("click", async () => {
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
