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

  // 手機瀏覽器打開、還沒加到主畫面就先鎖住畫面，逼使用者先加入主畫面
  // （或先換成 Safari）才能繼續用。桌面版（寬螢幕）不受影響，直接放行——
  // 「加入主畫面」本來就是行動裝置的概念，桌面瀏覽器沒有這回事。
  (function guardBrowserGate() {
    const isDesktopWidth = window.matchMedia && window.matchMedia("(min-width: 901px)").matches;
    if (isDesktopWidth) return;

    const byMediaQuery = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    const byIosFlag = window.navigator && window.navigator.standalone === true;
    const isStandalone = Boolean(byMediaQuery || byIosFlag);
    if (isStandalone) return;

    const ua = navigator.userAgent || "";
    const isSafari = /^((?!chrome|android|crios|fxios|edgios|opios|opr\/).)*safari/i.test(ua);

    document.addEventListener("DOMContentLoaded", () => {
      const gate = document.getElementById("browserGate");
      if (!gate) return;
      gate.classList.remove("hidden");

      const safariVariant = document.getElementById("browserGateSafari");
      const otherVariant = document.getElementById("browserGateOtherBrowser");

      if (isSafari) {
        if (safariVariant) safariVariant.classList.remove("hidden");
        // 這兩顆按鈕（小圖示 + 下面那顆大的圓角按鈕）都是同一個元件、同一段
        // 分享邏輯，按了會分享 App 連結本身（這個畫面還沒進到主程式，還沒有
        // 城市/天氣資料可以分享）。
        // 提醒：navigator.share() 跳出的系統分享清單不會有「加入主畫面」這個
        // 選項，那個只有 Safari 自己工具列上的分享圖示才有，這裡按了只是
        // 單純示範「分享」這個動作長什麼樣子，真正加入主畫面還是要點螢幕
        // 最下面 Safari 自己的工具列。
        const shareApp = async () => {
          const url = window.location.origin + window.location.pathname;
          if (navigator.share) {
            try {
              await navigator.share({ title: "MapSky 天氣", text: "MapSky —— 好用的天氣 App", url });
            } catch (e) {
              /* 使用者自己取消分享，不用特別處理 */
            }
            return;
          }
          try {
            await navigator.clipboard.writeText(url);
          } catch (e) {
            /* 複製也失敗就算了，不影響主要的加入主畫面流程 */
          }
        };
        const gateShareBtn = document.getElementById("browserGateShareBtn");
        if (gateShareBtn) gateShareBtn.addEventListener("click", shareApp);
        const gateShareBigBtn = document.getElementById("browserGateShareBigBtn");
        if (gateShareBigBtn) gateShareBigBtn.addEventListener("click", shareApp);
      } else {
        if (otherVariant) otherVariant.classList.remove("hidden");
        const urlEl = document.getElementById("browserGateUrlValue");
        if (urlEl) urlEl.textContent = window.location.href;
        const copyBtn = document.getElementById("browserGateCopyBtn");
        const msgEl = document.getElementById("browserGateCopyMsg");
        if (copyBtn) {
          copyBtn.addEventListener("click", async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
              if (msgEl) msgEl.textContent = "已複製，去 Safari 貼上打開吧";
            } catch (e) {
              if (msgEl) msgEl.textContent = "複製失敗，請手動選取上面的網址複製";
            }
          });
        }
      }
    });
  })();

  // 註冊 service worker，讓瀏覽器把這個網站判定為「可安裝的 App」，
  // 「加到主畫面」後系統會當成獨立軟體開啟，而不是網頁捷徑。
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {
        // 註冊失敗（例如非 https 環境）不影響網站其他功能，安靜忽略即可。
      });
    });
  }

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

  // 使用者在引導畫面沒選照片的話，就直接把這張預設圖存成他「真正」的
  // 大頭貼（不是前端裝出來的樣子，是後端資料庫裡真的存這張），這樣之後
  // 任何地方讀 avatarDataUrl 都會正常拿到圖片，不會再有特殊 fallback 邏輯。
  const DEFAULT_AVATAR_DATA_URL = "data:image/jpeg;base64,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";

  // ---- 第一次登入的引導畫面：取暱稱、選大頭貼（都選填），完成或跳過都會
  // 呼叫後端標記 onboarded，下次登入就不會再跳出來了。 ----
  function showOnboarding(session) {
    const gate = el("onboardingGate");
    if (!gate) return;
    gate.classList.remove("hidden");

    const avatarInput = el("onboardingAvatarInput");
    const avatarBtn = el("onboardingAvatarBtn");
    const avatarPreview = el("onboardingAvatarPreview");
    const avatarPlaceholder = el("onboardingAvatarPlaceholder");
    const nicknameInput = el("onboardingNicknameInput");
    const doneBtn = el("onboardingDoneBtn");
    if (!avatarInput || !avatarBtn || !nicknameInput || !doneBtn) return;

    nicknameInput.addEventListener("input", () => {
      nicknameInput.classList.remove("onboarding-input-error");
    });

    let pendingAvatarDataUrl = null;

    avatarBtn.addEventListener("click", () => avatarInput.click());
    avatarInput.addEventListener("change", async () => {
      const file = avatarInput.files && avatarInput.files[0];
      if (!file) return;
      try {
        const dataUrl = await resizeImageFile(file);
        pendingAvatarDataUrl = dataUrl;
        avatarPreview.src = dataUrl;
        avatarPreview.classList.remove("hidden");
        if (avatarPlaceholder) avatarPlaceholder.classList.add("hidden");
      } catch (e) {
        alert("大頭貼讀取失敗，請換一張圖片再試一次。");
      } finally {
        avatarInput.value = "";
      }
    });

    async function saveAndFinish(patch) {
      try {
        await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.assign({ onboarded: true }, patch)),
        });
      } catch (e) {
        /* 存不了也不要卡住使用者，至少讓他先進去用 */
      }
      gate.classList.add("hidden");
      // 重新整理讓設定頁、頭像這些地方直接讀到剛剛存的最新資料，
      // 不用另外手動同步好幾個地方的畫面。
      window.location.reload();
    }

    doneBtn.addEventListener("click", () => {
      const nickname = nicknameInput.value.trim();
      if (!nickname) {
        nicknameInput.focus();
        nicknameInput.classList.add("onboarding-input-error");
        return;
      }
      doneBtn.disabled = true;
      const patch = { nickname };
      // 沒選照片的話，直接用預設圖當作他「真正」的大頭貼存起來
      patch.avatarDataUrl = pendingAvatarDataUrl || DEFAULT_AVATAR_DATA_URL;
      saveAndFinish(patch);
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
    // 預設頭像直接內嵌成 SVG，不再另外載入外部圖檔——這樣就不會受到圖片
    // 路徑、快取、部署時機這些變數影響，跟其他一定會顯示的文字內容一樣可靠。
    const defaultAvatarSvg = `<svg viewBox="0 0 512 512" class="auth-avatar-img" role="img" aria-label="預設頭像">
      <circle cx="256" cy="256" r="256" fill="#c9ced6"/>
      <circle cx="256" cy="196" r="86" fill="#fff"/>
      <path d="M112 420c0-90 64-150 144-150s144 60 144 150c-38 46-92 72-144 72s-106-26-144-72z" fill="#fff"/>
    </svg>`;
    const avatarInner = avatarSrc
      ? `<img class="auth-avatar-img" src="${avatarSrc}" alt="大頭貼" />`
      : defaultAvatarSvg;

    bar.innerHTML = `
      <div class="auth-user">
        <div class="auth-avatar-wrap">
          ${avatarInner}
        </div>
        <div class="auth-user-info">
          <span class="auth-user-name">${escapeHtml(displayName)}</span>
          <span class="auth-user-provider">(${escapeHtml(session.provider)})</span>
        </div>
        <button id="authLogoutBtn" class="auth-logout-btn" type="button">登出</button>
      </div>
      ${midRow}`;

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

  // ---------------- 暱稱與大頭貼（獨立的編輯專區，跟上面的帳號摘要卡分開）----------------
  function buildProfileEditCard(session) {
    const card = document.createElement("div");
    card.id = "profileEditCard";
    card.className = "profile-edit-card";

    const avatarSrc = currentAvatarSrc(session);
    const defaultAvatarSvg = `<svg viewBox="0 0 512 512" class="profile-edit-avatar-img" role="img" aria-label="預設頭像">
      <circle cx="256" cy="256" r="256" fill="#c9ced6"/>
      <circle cx="256" cy="196" r="86" fill="#fff"/>
      <path d="M112 420c0-90 64-150 144-150s144 60 144 150c-38 46-92 72-144 72s-106-26-144-72z" fill="#fff"/>
    </svg>`;
    const avatarInner = avatarSrc
      ? `<img id="profileEditAvatarImg" class="profile-edit-avatar-img" src="${avatarSrc}" alt="大頭貼" />`
      : defaultAvatarSvg.replace("<svg ", '<svg id="profileEditAvatarImg" ');

    card.innerHTML = `
      <h3 class="profile-edit-title">✏️ 暱稱與大頭貼</h3>
      <div class="profile-edit-avatar-row">
        <div class="profile-edit-avatar-wrap">${avatarInner}</div>
        <div class="profile-edit-avatar-actions">
          <button id="profileAvatarChangeBtn" class="profile-avatar-change-btn" type="button">更換大頭貼</button>
          <input id="profileAvatarFileInput" type="file" accept="image/*" class="hidden" />
          <p class="profile-edit-hint">建議使用正方形圖片，會自動縮小處理。</p>
        </div>
      </div>
      <div class="profile-edit-nickname-row">
        <label for="profileNicknameInput" class="profile-edit-label">暱稱</label>
        <div class="profile-edit-nickname-inline">
          <input id="profileNicknameInput" type="text" maxlength="20" placeholder="輸入暱稱（最多 20 字）" value="${escapeHtml((session.profile && session.profile.nickname) || "")}" />
          <button id="profileNicknameSaveBtn" class="profile-nickname-save-btn" type="button">儲存</button>
        </div>
        <p id="profileNicknameMsg" class="profile-edit-hint"></p>
      </div>
    `;

    // ---- 大頭貼上傳 ----
    const avatarChangeBtn = card.querySelector("#profileAvatarChangeBtn");
    const avatarFileInput = card.querySelector("#profileAvatarFileInput");
    if (avatarChangeBtn && avatarFileInput) {
      avatarChangeBtn.addEventListener("click", () => avatarFileInput.click());
      avatarFileInput.addEventListener("change", async () => {
        const file = avatarFileInput.files && avatarFileInput.files[0];
        if (!file) return;
        avatarChangeBtn.disabled = true;
        avatarChangeBtn.textContent = "上傳中…";
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

          const imgEl = card.querySelector("#profileEditAvatarImg");
          if (imgEl && imgEl.tagName === "IMG") {
            imgEl.src = dataUrl;
          } else if (imgEl) {
            const newImg = document.createElement("img");
            newImg.id = "profileEditAvatarImg";
            newImg.className = "profile-edit-avatar-img";
            newImg.alt = "大頭貼";
            newImg.src = dataUrl;
            imgEl.replaceWith(newImg);
          }
          // 上面帳號摘要卡的小頭像、底部導覽列/分頁列的設定圖示，都跟著換新
          const barAvatar = document.querySelector("#authBar .auth-avatar-img");
          if (barAvatar && barAvatar.tagName === "IMG") barAvatar.src = dataUrl;
          applySettingsAvatarIcon(dataUrl);
        } catch (e) {
          alert("大頭貼上傳失敗，請換一張圖片再試一次。");
        } finally {
          avatarChangeBtn.disabled = false;
          avatarChangeBtn.textContent = "更換大頭貼";
          avatarFileInput.value = "";
        }
      });
    }

    // ---- 暱稱編輯 ----
    const nicknameInput = card.querySelector("#profileNicknameInput");
    const nicknameSaveBtn = card.querySelector("#profileNicknameSaveBtn");
    const nicknameMsg = card.querySelector("#profileNicknameMsg");

    // 算一下暱稱是不是還在冷卻期內：後端存了上次改名的時間
    // （session.profile.nicknameChangedAt）跟目前設定的冷卻天數
    // （session.nicknameCooldownDays），兩個都有值才需要算，缺一個
    // 就當作沒有冷卻限制（沒改過名字，或後台沒開冷卻功能）。
    function nicknameCooldownRemainingDays() {
      const days = session.nicknameCooldownDays;
      const changedAt = session.profile && session.profile.nicknameChangedAt;
      if (!days || !changedAt) return 0;
      const cooldownMs = days * 24 * 60 * 60 * 1000;
      const elapsedMs = Date.now() - changedAt;
      if (elapsedMs >= cooldownMs) return 0;
      return Math.ceil((cooldownMs - elapsedMs) / (24 * 60 * 60 * 1000));
    }

    const remainingDays = nicknameCooldownRemainingDays();
    if (remainingDays > 0 && nicknameInput && nicknameSaveBtn) {
      nicknameInput.disabled = true;
      nicknameSaveBtn.disabled = true;
      if (nicknameMsg) nicknameMsg.textContent = `暱稱改過了，還要等 ${remainingDays} 天才能再改一次。`;
    }

    if (nicknameSaveBtn && nicknameInput) {
      nicknameSaveBtn.addEventListener("click", async () => {
        const value = nicknameInput.value.trim();
        nicknameSaveBtn.disabled = true;
        if (nicknameMsg) nicknameMsg.textContent = "";
        try {
          const resp = await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nickname: value }),
          });
          const result = await resp.json();
          if (!resp.ok || !result.ok) {
            if (result && result.reason === "nickname-cooldown") {
              if (nicknameMsg) nicknameMsg.textContent = `暱稱改過了，還要等 ${result.remainingDays} 天才能再改一次。`;
              return;
            }
            throw new Error((result && result.reason) || "儲存失敗");
          }
          session.profile.nickname = value;
          const barName = document.querySelector("#authBar .auth-user-name");
          if (barName) barName.textContent = value || session.profile.name || "使用者";
          if (nicknameMsg) nicknameMsg.textContent = "已儲存 ✅";
        } catch (e) {
          if (nicknameMsg) nicknameMsg.textContent = "儲存失敗，請再試一次。";
        } finally {
          nicknameSaveBtn.disabled = false;
        }
      });
    }

    return card;
  }

  // ---------------- 暱稱與大頭貼：設定頁上收合成一條，點下去才彈出編輯卡片 ----------------
  function buildProfileEditEntry(session) {
    const row = document.createElement("button");
    row.type = "button";
    row.id = "profileEditEntryBtn";
    row.className = "settings-list-item";
    row.innerHTML = `
      <span class="settings-list-item-icon">✏️</span>
      <span class="settings-list-item-label">暱稱與大頭貼</span>
      <span class="settings-list-item-arrow">›</span>
    `;

    row.addEventListener("click", () => {
      const slot = el("profileEditPanelSlot");
      if (slot) {
        slot.innerHTML = "";
        slot.appendChild(buildProfileEditCard(session));
      }
      // 沒有對應的頂部分頁按鈕（這是設定底下的子頁面，不是主導覽項目），
      // 所以自己重現一次 renderer.js 那邊「切分頁」該做的事：清掉舊的
      // active、把這個分頁標成 active、頁首（城市名稱那排）跟其他設定類
      // 分頁一樣要藏起來。底部導覽列的「設定」維持亮著就好，不用去動它。
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      const panel = el("profileEditPanel");
      if (panel) panel.classList.add("active");
      const mainHeader = document.querySelector(".main-header");
      if (mainHeader) mainHeader.classList.add("hidden");
    });

    const backBtn = el("profileEditBackBtn");
    if (backBtn && !backBtn.dataset.bound) {
      backBtn.dataset.bound = "1";
      backBtn.addEventListener("click", () => {
        const settingsTabBtn = document.querySelector('.tab-btn[data-tab="settings"]');
        if (settingsTabBtn) settingsTabBtn.click();
      });
    }

    return row;
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

  // VAPID 公鑰是 base64url 字串，瀏覽器的 pushManager.subscribe 要吃 Uint8Array，中間要轉換一次。
  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  // 是不是用「加到主畫面」的獨立模式打開的（而不是一般瀏覽器分頁）。
  // iOS Safari 用 navigator.standalone，其他瀏覽器看 display-mode media query。
  // 掛在 window.appInfo 上是因為 renderer.js 要等登入成功才會被動態載入進來，
  // 晚於這支檔案執行，需要一個地方存這個判斷結果給它用。
  function isStandalonePwa() {
    const byMediaQuery = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    const byIosFlag = window.navigator && window.navigator.standalone === true;
    return Boolean(byMediaQuery || byIosFlag);
  }
  window.appInfo.isStandalone = isStandalonePwa();

  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  // 訂閱推播。silent=true 時不跳 alert（給「加到主畫面自動詢問」用，
  // 使用者還沒表態就自動彈的情境下，失敗了默默放棄就好，不用打擾他）。
  async function subscribeToPush(session, { silent = false } = {}) {
    if (!pushSupported()) return false;
    if (!session.vapidPublicKey) {
      if (!silent) alert("目前尚未設定推播金鑰，請聯絡管理員。");
      return false;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        if (!silent) alert("需要允許通知權限才能開啟推播。");
        return false;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(session.vapidPublicKey),
      });
      await fetch("/api/auth/session?action=push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      return true;
    } catch (e) {
      if (!silent) alert("設定推播時發生錯誤，請再試一次。");
      return false;
    }
  }

  async function unsubscribeFromPush() {
    if (!pushSupported()) return false;
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (!existing) return true;
    await fetch("/api/auth/session?action=push-unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: existing.endpoint }),
    });
    await existing.unsubscribe();
    return true;
  }

  // 加到主畫面、用獨立 App 模式打開時，如果使用者還沒表態過要不要通知
  // （Notification.permission 還是預設值 "default"），自動幫他跳出系統的
  // 允許通知彈窗，不用特地跑去設定頁找。使用者一旦選過允許/拒絕，
  // permission 就不會再是 "default"，這裡也就不會再自動跳出來。
  async function maybeAutoPromptPush(session) {
    if (!pushSupported()) return;
    if (!isStandalonePwa()) return;
    if (Notification.permission !== "default") return;
    if (!session.vapidPublicKey) return;
    const alreadySubscribed = await navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription());
    if (alreadySubscribed) return;
    await subscribeToPush(session, { silent: true });
  }

  // ---------------- 推播通知：訂閱／取消訂閱一條列表項目 ----------------
  function buildPushNotificationEntry(session) {
    const row = document.createElement("button");
    row.type = "button";
    row.id = "pushNotificationBtn";
    row.className = "settings-list-item";
    row.innerHTML = `
      <span class="settings-list-item-icon">🔔</span>
      <span class="settings-list-item-label">推播通知</span>
      <span class="settings-list-item-arrow" id="pushNotificationState">…</span>
    `;
    const stateEl = row.querySelector("#pushNotificationState");

    async function refreshState() {
      if (!pushSupported()) {
        stateEl.textContent = "此瀏覽器不支援";
        return null;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      stateEl.textContent = sub ? "已開啟 ✓" : "點擊開啟";
      return sub;
    }

    row.addEventListener("click", async () => {
      if (!pushSupported()) return;
      row.disabled = true;
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          // 已經同意過的話，不讓使用者在 App 裡面直接關閉推播——
          // 瀏覽器的通知權限本來就只能靠系統設定收回，這裡改成引導過去，
          // 避免使用者以為點一下就關掉了，結果系統權限其實還開著、行為不一致。
          alert("要關閉推播通知，請到手機的「設定」App 裡調整這個網站/App 的通知權限，沒辦法直接在這裡關閉。");
        } else {
          await subscribeToPush(session);
        }
      } catch (e) {
        alert("設定推播時發生錯誤，請再試一次。");
      } finally {
        row.disabled = false;
        refreshState();
      }
    });

    refreshState();
    return row;
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
  function showMaintenanceScreen(session, providers) {
    const gate = el("maintenanceGate");
    const loginGate = el("loginGate");
    if (loginGate) loginGate.classList.add("hidden");
    if (gate) gate.classList.remove("hidden");
    document.body.classList.add("maintenance-locked");

    // 這個畫面現在只會在「已經登入、但不是管理員」的情況出現，所以直接
    // 顯示登出按鈕；不用像以前那樣還要判斷有沒有登入、動態決定要不要
    // 顯示登入按鈕清單。
    const logoutBtn = el("maintenanceLogoutBtn");
    if (logoutBtn) {
      logoutBtn.classList.remove("hidden");
      if (!logoutBtn.dataset.bound) {
        logoutBtn.dataset.bound = "1";
        logoutBtn.addEventListener("click", async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.href = "/";
        });
      }
    }

    const link = el("maintenanceAdminLoginBtn");
    if (link && !link.dataset.bound) {
      link.dataset.bound = "1";
      link.addEventListener("click", () => {
        if (gate) gate.classList.add("hidden");
        if (loginGate) loginGate.classList.remove("hidden");
        const statusEl = el("loginGateStatus");
        if (statusEl) statusEl.textContent = "這個帳號不是管理員，維護模式期間無法使用。";
      });
    }
  }

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

    // 維護模式：後台開關打開時，非管理員一律鎖住，連 App 本體
    // （renderer.js）都不會載入，不只是畫面被蓋住而已。
    // 但只有「已經登入、確認不是管理員」才會擋，還沒登入的人先讓他走
    // 正常的登入流程（不然使用者連登入按鈕都看不到，沒辦法登入管理員
    // 帳號，也沒辦法讓後台知道他到底是不是管理員）。
    const isAdminUser = Boolean(session.loggedIn && session.isAdmin);
    if (session.maintenanceMode && session.loggedIn && !isAdminUser) {
      showMaintenanceScreen(session, providers);
      return;
    }

    if (session.loggedIn) {
      document.body.classList.add("auth-ok");
      if (!session.profile.onboarded) showOnboarding(session);
      const slot = el("settingsAccountSlot");
      if (slot) {
        slot.innerHTML = "";
        slot.appendChild(buildUserBar(session));
        slot.appendChild(buildProfileEditEntry(session));
        slot.appendChild(buildPushNotificationEntry(session));
        maybeAutoPromptPush(session);
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
