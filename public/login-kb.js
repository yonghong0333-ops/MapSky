/* login-kb.js — 點電子郵件：標題/副標題上移隱藏，更多登入一併上移；鍵盤收起還原 */
(function () {
  var STYLE_ID = "mapsky-login-kb-css";

  function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
      ".login-gate .login-gate-title," +
      ".login-gate .login-gate-title--terminal," +
      ".login-gate .login-gate-tagline," +
      ".login-gate .login-gate-tagline--terminal{" +
      "max-height:90px;opacity:1;transform:translateY(0) scale(1);overflow:hidden;" +
      "transition:max-height .3s ease,opacity .25s ease,margin .3s ease,transform .3s cubic-bezier(.22,1,.36,1);" +
      "}" +
      ".login-gate--kb .login-gate-title," +
      ".login-gate--kb .login-gate-title--terminal," +
      ".login-gate--kb .login-gate-tagline," +
      ".login-gate--kb .login-gate-tagline--terminal{" +
      "max-height:0!important;min-height:0!important;margin:0!important;padding:0!important;" +
      "opacity:0!important;transform:translateY(-20px) scale(.96);pointer-events:none!important;" +
      "}" +
      ".login-gate-card.is-kb-lift{" +
      "transition:transform .32s cubic-bezier(.22,1,.36,1)!important;will-change:transform;" +
      "}" +
      ".login-gate--kb .login-gate-card{padding-top:6px!important;padding-bottom:14px!important;}" +
      ".login-gate--kb .login-gate-status{margin-bottom:4px!important;}" +
      ".login-gate--kb .login-gate-buttons{gap:8px!important;}" +
      ".login-gate--kb .login-gate-more-toggle{margin-top:4px!important;}";
    document.head.appendChild(s);
  }

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  ready(function () {
    injectCss();
    var emailInput = document.getElementById("loginGateMagicEmail");
    var loginGate = document.getElementById("loginGate");
    var loginCard = emailInput && emailInput.closest(".login-gate-card");
    if (!emailInput || !loginGate || !loginCard) return;
    if (loginCard.dataset.kbCompact === "1") return;
    loginCard.dataset.kbCompact = "1";

    function keyboardHeight() {
      var vv = window.visualViewport;
      var inner = window.innerHeight || 0;
      var reported = 0;
      if (vv && inner) {
        reported = Math.round(inner - vv.height - (vv.offsetTop || 0));
      }
      if (reported > 80) return reported;
      return Math.round(Math.min(360, inner * 0.44));
    }

    function place() {
      if (document.activeElement !== emailInput) return;
      loginGate.classList.add("login-gate--kb");
      loginCard.classList.add("is-kb-lift");
      requestAnimationFrame(function () {
        if (document.activeElement !== emailInput) return;
        loginCard.style.transition = "none";
        var rect = emailInput.getBoundingClientRect();
        var visibleBottom = window.innerHeight - keyboardHeight() - 12;
        var shift = Math.max(0, Math.ceil(rect.bottom + 16 - visibleBottom));
        loginCard.style.transform = shift
          ? "translate3d(0," + -shift + "px,0)"
          : "";
        requestAnimationFrame(function () {
          loginCard.style.transition = "";
        });
      });
    }

    function drop() {
      setTimeout(function () {
        if (document.activeElement === emailInput) return;
        loginCard.style.transform = "";
        loginCard.classList.remove("is-kb-lift");
        loginGate.classList.remove("login-gate--kb");
      }, 60);
    }

    emailInput.addEventListener("focus", function () {
      loginGate.classList.add("login-gate--kb");
      place();
      setTimeout(place, 90);
      setTimeout(place, 280);
      setTimeout(place, 500);
    });
    emailInput.addEventListener("blur", drop);

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", place);
      window.visualViewport.addEventListener("scroll", place);
    }
  });
})();
