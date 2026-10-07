function endLoginGateBoot(opts) {
    opts = opts || {};
    if (loginGateBootSafetyTimer) { clearTimeout(loginGateBootSafetyTimer); loginGateBootSafetyTimer = null; }
    if (loginGateWeatherTimer) { clearInterval(loginGateWeatherTimer); loginGateWeatherTimer = null; }
    const gate = el("loginGate");
    const boot = el("loginGateBoot");
    function hideBoot() {
      if (boot) {
        boot.classList.add("hidden");
        boot.classList.remove("login-gate-boot--exit");
      }
      if (gate) {
        gate.classList.remove("login-gate--booting");
        gate.classList.remove("login-gate--opening");
      }
    }
    if (opts.immediate || !gate || !gate.classList.contains("login-gate--booting")) {
      hideBoot();
      return;
    }
    if (gate.classList.contains("login-gate--opening")) {
      hideBoot();
      return;
    }
    gate.classList.add("login-gate--opening");
    if (boot) boot.classList.add("login-gate-boot--exit");
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      hideBoot();
    }
    function onEnd(e) {
      if (e && e.target !== gate) return;
      gate.removeEventListener("transitionend", onEnd);
      finish();
    }
    gate.addEventListener("transitionend", onEnd);
    setTimeout(finish, 500);
  }
