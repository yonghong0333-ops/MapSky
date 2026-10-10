/* login-kb.js — 點電子郵件時標題/副標題上移隱藏，鍵盤收起後還原 */
(function () {
  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  ready(function () {
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
      // 先收合標題再量測，避免按鈕蓋住標題
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
