// ------------------------------------------------------------------
// web-shim.js —— 網頁版適配層
// 原本 apps/weather/renderer.js 是透過 Electron 的 window.weatherAPI（由
// preload.js 用 ipcRenderer 橋接到 main process）拿資料。網頁版沒有 Electron，
// 這支檔案在 renderer.js 載入「之前」先把同樣長相的 window.weatherAPI / window.appInfo
// 補上，內部改成 fetch 呼叫 /api/weather/* 這幾支 serverless function。
// renderer.js 本身完全不用改動。
// ------------------------------------------------------------------
(function () {
  window.appInfo = { platform: "web" };

  const updatedListeners = [];
  const alertsUpdatedListeners = [];

  async function getJson(url) {
    const resp = await fetch(url);
    return resp.json();
  }

  window.weatherAPI = {
    getApiKeyStatus: () => getJson("/api/weather/status"),

    getCity: async (label) => {
      const r = await getJson(`/api/weather/city?label=${encodeURIComponent(label)}`);
      return r.ok ? r.data : null;
    },

    getAll: () => getJson("/api/weather/all"),
    forceRefresh: () => getJson("/api/weather/all?refresh=1"),

    getAlerts: () => getJson("/api/weather/alerts"),
    forceRefreshAlerts: () => getJson("/api/weather/alerts?refresh=1"),
    getTyphoonProbability: () => getJson("/api/weather/typhoon"),
    getSunTimes: () => getJson("/api/weather/astro?type=sun"),
    getMoonTimes: () => getJson("/api/weather/astro?type=moon"),
    getUvIndex: () => getJson("/api/weather/astro?type=uv"),
    getWeeklyForecast: () => getJson("/api/weather/astro?type=weekly"),
    getWindObservation: () => getJson("/api/weather/wind"),

    onUpdated: (cb) => updatedListeners.push(cb),
    onAlertsUpdated: (cb) => alertsUpdatedListeners.push(cb),
  };

  // 網頁版沒有常駐 process 可以主動推播，改成定時輪詢後觸發跟原本一樣的 callback，
  // renderer.js 裡的 onUpdated / onAlertsUpdated 邏輯完全不用改。
  // 這段輪詢只在登入成功、renderer.js 被載入之後才會啟動（見 startAppAfterLogin）。
  const POLL_MS = 5 * 60 * 1000;
  function startPolling() {
    setInterval(async () => {
      try {
        const data = await window.weatherAPI.getAlerts();
        if (data.ok) {
          const activeCount = (data.alerts || []).filter((a) => a.isActive).length;
          alertsUpdatedListeners.forEach((cb) => cb({ updatedAt: data.updatedAt, activeCount }));
        }
      } catch {
        /* 網路暫時失敗就等下一輪 */
      }
    }, POLL_MS);
  }

  // ---------------- 登入狀態 / 使用者列 ----------------
  const PROVIDER_ICON = {
    google: null, // 用內建 SVG（見下方），不用圖檔
    facebook: "login-icons/facebook.png",
    microsoft: "login-icons/microsoft.png",
    discord: "login-icons/discord.png",
    github: "login-icons/github.png",
    yahoo: "login-icons/yahoo.png",
  };

  const GOOGLE_SVG = `<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 7 29.5 5 24 5c-7.7 0-14.4 4.3-17.7 10.7z"/><path fill="#4CAF50" d="M24 44c5.4 0 10.3-2.1 14-5.5l-6.5-5.5c-2 1.5-4.6 2.5-7.5 2.5-5.2 0-9.6-3.5-11.2-8.2l-6.6 5.1C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.5 5.5C41.9 35.6 44 30.2 44 24c0-1.3-.1-2.7-.4-3.5z"/></svg>`;

  function el(id) {
    return document.getElementById(id);
  }

  async function loadProviders() {
    const { providers } = await getJson("/api/auth/providers");
    return providers;
  }

  async function loadSession() {
    return getJson("/api/auth/session");
  }

  function buildUserBar(session) {
    const bar = document.createElement("div");
    bar.id = "authBar";
    bar.className = "auth-bar";
    bar.innerHTML = `
      <div class="auth-user">
        <span class="auth-user-name">${escapeHtml(session.profile.name || "使用者")}</span>
        <span class="auth-user-provider">(${escapeHtml(session.provider)})</span>
        <button id="authLogoutBtn" class="auth-logout-btn" type="button">登出</button>
      </div>`;
    return bar;
  }

  function buildGateButtons(providers) {
    return providers
      .map((p) => {
        const icon = p.id === "google" ? GOOGLE_SVG : `<img src="${PROVIDER_ICON[p.id]}" alt="" />`;
        const disabled = p.configured ? "" : "disabled title=\"尚未設定\"";
        return `<a class="login-gate-btn" href="/api/auth/login?provider=${p.id}" ${disabled}>${icon}<span>使用 ${escapeHtml(p.label)} 登入</span></a>`;
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------------- 設定面板（帳號資訊 + 登出）----------------
  // 側欄的「⚙️ 帳號 / 設定」按鈕跟手機底部導覽列的「設定」按鈕，
  // 共用同一個面板；renderer.js 載入後會透過 window.openSettingsMenu 呼叫。
  function openSettingsMenu() {
    el("settingsMenu").classList.add("open");
    el("settingsMenuOverlay").classList.add("open");
  }
  function closeSettingsMenu() {
    el("settingsMenu").classList.remove("open");
    el("settingsMenuOverlay").classList.remove("open");
  }
  window.openSettingsMenu = openSettingsMenu;
  window.closeSettingsMenu = closeSettingsMenu;

  function initSettingsMenu() {
    const btn = el("sidebarSettingsBtn");
    if (btn) btn.addEventListener("click", openSettingsMenu);
    const overlay = el("settingsMenuOverlay");
    if (overlay) overlay.addEventListener("click", closeSettingsMenu);
    const closeBtn = el("settingsMenuCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", closeSettingsMenu);
  }

  const LOGIN_ERROR_LABEL = {
    access_denied: "已取消登入",
  };

  function showGateError() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("login") !== "error") return;
    const reason = params.get("reason") || "";
    const errEl = el("loginGateError");
    if (errEl) {
      errEl.textContent = `登入失敗，請再試一次。${LOGIN_ERROR_LABEL[reason] ? `（${LOGIN_ERROR_LABEL[reason]}）` : ""}`;
      errEl.classList.remove("hidden");
    }
    // 清掉網址上的 query string，避免重新整理又跳一次錯誤訊息
    window.history.replaceState({}, "", window.location.pathname);
  }

  // 一定要先登入才能開啟功能：預設整個 .app 是隱藏的（見 CSS），
  // 只有確認 session 有效後才在 body 加上 auth-ok，讓主畫面顯示出來。
  async function initAuthGate() {
    showGateError();
    const statusEl = el("loginGateStatus");
    const buttonsEl = el("loginGateButtons");

    let providers, session;
    try {
      [providers, session] = await Promise.all([loadProviders(), loadSession()]);
    } catch {
      if (statusEl) statusEl.textContent = "無法連線到登入伺服器，請重新整理再試一次。";
      return;
    }

    if (session.loggedIn) {
      document.body.classList.add("auth-ok");
      const slot = el("settingsAccountSlot");
      if (slot) {
        slot.innerHTML = "";
        slot.appendChild(buildUserBar(session));
        const logoutBtn = el("authLogoutBtn");
        if (logoutBtn) {
          logoutBtn.addEventListener("click", async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.href = "/";
          });
        }
      }
      initSettingsMenu();
      startAppAfterLogin();
      return;
    }

    // 未登入：把主畫面繼續擋著，只在登入畫面上顯示可用的登入方式
    if (statusEl) statusEl.textContent = "請先登入以下任一帳號：";
    if (buttonsEl) {
      buttonsEl.innerHTML = buildGateButtons(providers);
      buttonsEl.classList.remove("hidden");
    }
  }

  // 只有登入成功才把真正的功能（renderer.js + 輪詢）載入進來，
  // 沒登入的話 renderer.js 完全不會被載入，/api/weather/* 也不會被呼叫，
  // 不只是畫面被擋住而已。
  let appStarted = false;
  function startAppAfterLogin() {
    if (appStarted) return;
    appStarted = true;
    startPolling();
    const script = document.createElement("script");
    script.src = "renderer.js";
    document.body.appendChild(script);
  }

  document.addEventListener("DOMContentLoaded", initAuthGate);
})();
