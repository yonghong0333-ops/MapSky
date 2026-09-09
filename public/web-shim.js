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

  function currentAvatarSrc(session) {
    return (session.profile && (session.profile.avatarDataUrl || session.profile.avatarUrl)) || "";
  }

  function currentDisplayName(session) {
    return (session.profile && (session.profile.nickname || session.profile.name)) || "使用者";
  }

  // 「設定」的圖示（底部導覽列 + 桌面分頁列）換成使用者大頭貼，沒有大頭貼就
  // 維持原本的齒輪圖示／emoji，不用特別處理「沒有圖」的狀態。
  function applySettingsAvatarIcon(src) {
    if (!src) return;
    const bottomIconSpan = document.querySelector('.bottom-nav-btn[data-bottom="settings"] .bottom-nav-icon');
    if (bottomIconSpan) {
      bottomIconSpan.innerHTML = `<img src="${src}" class="bottom-nav-avatar-img" alt="">`;
    }
    const tabBtn = document.querySelector('.tab-btn[data-tab="settings"]');
    if (tabBtn) {
      tabBtn.innerHTML = `<img src="${src}" class="tab-avatar-img" alt="">設定`;
    }
  }
  window.applySettingsAvatarIcon = applySettingsAvatarIcon;

  // 把選好的圖片縮小成正方形小圖再轉成 base64，不然直接把原圖傳上去
  // 存進 Redis 很容易一張圖就好幾 MB，這裡統一縮到最長邊 160px、JPEG 壓縮。
  function resizeImageFile(file, maxSize = 160, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("讀取圖片失敗"));
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => reject(new Error("圖片格式無法讀取"));
        img.onload = () => {
          let { width, height } = img;
          if (width > height) {
            if (width > maxSize) {
              height = Math.round(height * (maxSize / width));
              width = maxSize;
            }
          } else if (height > maxSize) {
            width = Math.round(width * (maxSize / height));
            height = maxSize;
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function buildUserBar(session) {
    const bar = document.createElement("div");
    bar.id = "authBar";
    bar.className = "auth-bar";
    const midRow = session.memberId
      ? `<div class="auth-mid-row">
          <span class="auth-mid-label">我的會員 ID（MID）</span>
          <span class="auth-mid-value" id="authMidValue">${escapeHtml(session.memberId)}</span>
          <button id="authMidCopyBtn" class="auth-mid-copy-btn" type="button">
          <img id="authMidCopyIconDefault" src="icons/copy-icon.png" class="auth-mid-copy-icon" alt="複製" />
          <img id="authMidCopyIconDone" src="icons/copied-check-green.png" class="auth-mid-copy-icon hidden" alt="已複製" />
        </button>
        </div>
        <p class="auth-mid-hint">想申請成為管理員的話，把這組 ID 複製後傳給管理員就可以了。</p>`
      : "";

    const avatarSrc = currentAvatarSrc(session);
    const displayName = currentDisplayName(session);
    const avatarInner = avatarSrc
      ? `<img id="authAvatarImg" class="auth-avatar-img" src="${avatarSrc}" alt="大頭貼" />`
      : `<img id="authAvatarImg" class="auth-avatar-img" src="icons/user-avatar-default.png" alt="預設頭像" />`;

    bar.innerHTML = `
      <div class="auth-user">
        <div class="auth-avatar-wrap">
          ${avatarInner}
          <button id="authAvatarEditBtn" class="auth-avatar-edit-btn" type="button" aria-label="更換大頭貼">📷</button>
          <input id="authAvatarFileInput" type="file" accept="image/*" class="auth-avatar-file-input hidden" />
        </div>
        <div class="auth-user-info">
          <div class="auth-user-name-row">
            <span id="authUserNameDisplay" class="auth-user-name">${escapeHtml(displayName)}</span>
            <button id="authNicknameEditBtn" class="auth-nickname-edit-btn" type="button" aria-label="編輯暱稱">✏️</button>
          </div>
          <span class="auth-user-provider">(${escapeHtml(session.provider)})</span>
        </div>
        <button id="authLogoutBtn" class="auth-logout-btn" type="button">登出</button>
      </div>
      <div id="authNicknameEditRow" class="auth-nickname-edit-row hidden">
        <input id="authNicknameInput" type="text" maxlength="20" placeholder="輸入暱稱（最多 20 字）" />
        <button id="authNicknameSaveBtn" class="auth-nickname-save-btn" type="button">儲存</button>
        <button id="authNicknameCancelBtn" class="auth-nickname-cancel-btn" type="button">取消</button>
      </div>
      ${midRow}`;

    // ---- 大頭貼上傳 ----
    const avatarEditBtn = bar.querySelector("#authAvatarEditBtn");
    const avatarFileInput = bar.querySelector("#authAvatarFileInput");
    if (avatarEditBtn && avatarFileInput) {
      avatarEditBtn.addEventListener("click", () => avatarFileInput.click());
      avatarFileInput.addEventListener("change", async () => {
        const file = avatarFileInput.files && avatarFileInput.files[0];
        if (!file) return;
        avatarEditBtn.disabled = true;
        try {
          const dataUrl = await resizeImageFile(file);
          const resp = await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ avatarDataUrl: dataUrl }),
          });
          const result = await resp.json();
          if (!resp.ok || !result.ok) throw new Error((result && result.reason) || "上傳失敗");
          session.profile.avatarDataUrl = dataUrl;
          const imgEl = bar.querySelector("#authAvatarImg");
          if (imgEl && imgEl.tagName === "IMG") {
            imgEl.src = dataUrl;
          } else if (imgEl) {
            // 原本是文字佔位頭像，換成真的圖片元素
            const newImg = document.createElement("img");
            newImg.id = "authAvatarImg";
            newImg.className = "auth-avatar-img";
            newImg.alt = "大頭貼";
            newImg.src = dataUrl;
            imgEl.replaceWith(newImg);
          }
          applySettingsAvatarIcon(dataUrl);
        } catch (e) {
          alert("大頭貼上傳失敗，請換一張圖片再試一次。");
        } finally {
          avatarEditBtn.disabled = false;
          avatarFileInput.value = "";
        }
      });
    }

    // ---- 暱稱編輯 ----
    const nicknameEditBtn = bar.querySelector("#authNicknameEditBtn");
    const nicknameRow = bar.querySelector("#authNicknameEditRow");
    const nicknameInput = bar.querySelector("#authNicknameInput");
    const nicknameSaveBtn = bar.querySelector("#authNicknameSaveBtn");
    const nicknameCancelBtn = bar.querySelector("#authNicknameCancelBtn");
    const nameDisplay = bar.querySelector("#authUserNameDisplay");
    if (nicknameEditBtn && nicknameRow && nicknameInput) {
      nicknameEditBtn.addEventListener("click", () => {
        nicknameInput.value = (session.profile && session.profile.nickname) || "";
        nicknameRow.classList.remove("hidden");
        nicknameInput.focus();
      });
    }
    if (nicknameCancelBtn && nicknameRow) {
      nicknameCancelBtn.addEventListener("click", () => nicknameRow.classList.add("hidden"));
    }
    if (nicknameSaveBtn && nicknameInput && nameDisplay) {
      nicknameSaveBtn.addEventListener("click", async () => {
        const value = nicknameInput.value.trim();
        nicknameSaveBtn.disabled = true;
        try {
          const resp = await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nickname: value }),
          });
          const result = await resp.json();
          if (!resp.ok || !result.ok) throw new Error((result && result.reason) || "儲存失敗");
          session.profile.nickname = value;
          nameDisplay.textContent = value || session.profile.name || "使用者";
          nicknameRow.classList.add("hidden");
        } catch (e) {
          alert("暱稱儲存失敗，請再試一次。");
        } finally {
          nicknameSaveBtn.disabled = false;
        }
      });
    }

    const copyBtn = bar.querySelector("#authMidCopyBtn");
    const copyIconDefault = bar.querySelector("#authMidCopyIconDefault");
    const copyIconDone = bar.querySelector("#authMidCopyIconDone");
    if (copyBtn && copyIconDefault && copyIconDone) {
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(session.memberId);
          copyIconDefault.classList.add("hidden");
          copyIconDone.classList.remove("hidden");
          copyBtn.classList.add("copied"); // 複製成功後藍色底色按鈕消失，只留綠色勾勾圖示
          setTimeout(() => {
            copyIconDone.classList.add("hidden");
            copyIconDefault.classList.remove("hidden");
            copyBtn.classList.remove("copied");
          }, 5000);
        } catch (e) {
          /* 複製失敗就算了，使用者還是能自己手動選取文字複製 */
        }
      });
    }
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

  // ---------------- 設定入口（帳號資訊 + 登出）----------------
  // 現在「設定」已經是跟其他分頁（未來 7 天／溫度趨勢圖…）同一種真正的
  // tab-panel，不再是另外浮出來的面板。側欄的「⚙️ 帳號 / 設定」按鈕
  // 這裡只是幫忙點一下對應的分頁按鈕，換頁邏輯統一交給 renderer.js 處理。
  function initSettingsMenu() {
    const btn = el("sidebarSettingsBtn");
    if (btn) {
      btn.addEventListener("click", () => {
        const tabBtn = document.querySelector('.tab-btn[data-tab="settings"]');
        if (tabBtn) tabBtn.click();
      });
    }
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
        applySettingsAvatarIcon(currentAvatarSrc(session));
        const logoutBtn = el("authLogoutBtn");
        if (logoutBtn) {
          logoutBtn.addEventListener("click", async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.href = "/";
          });
        }
      }
      // 只有 ADMIN_IDS 白名單內的帳號才會看到「後台管理」按鈕。這裡只是
      // 決定要不要「顯示」，真正的權限檢查在後端 /api/weather/status?admin=1
      // 那邊做，藏起來只是體驗上不要讓一般使用者看到用不到的按鈕。
      if (session.isAdmin) {
        const adminBtn = el("adminBottomBtn");
        if (adminBtn) adminBtn.classList.remove("hidden");
        const adminTab = el("adminTabBtn");
        if (adminTab) adminTab.classList.remove("hidden");
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
