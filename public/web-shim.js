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

  // 是不是在 Capacitor 包出來的原生殼（iOS／Android App）裡執行。
  // capacitor.config.json 的 ios.appendUserAgent 把 "MapSkyiOS" 加進了
  // User-Agent，這裡拿來當判斷依據；window.Capacitor 是否存在也一起判斷，
  // 兩者符合其一即可。guardBrowserGate（要不要顯示「加入主畫面」引導畫面）
  // 跟下面的原生登入流程都靠這個變數判斷。
  
  // Force-hide boot overlay whenever login form is shown (not booting)
  (function injectBootHideCss() {
    if (document.getElementById("mapsky-boot-hide-css")) return;
    var s = document.createElement("style");
    s.id = "mapsky-boot-hide-css";
    s.textContent = ".login-gate:not(.login-gate--booting) .login-gate-boot{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}.login-gate-boot.hidden{display:none!important}";
    (document.head || document.documentElement).appendChild(s);
  })();

  const isNativeShell = /MapSkyiOS/i.test(navigator.userAgent || "") ||
    Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());
  window.appInfo.isNativeApp = isNativeShell;

  // 這個路徑指向 public/downloads/MapSky_Installbox.exe，是使用者自己包好、
  // 手動放上去的安裝檔，跟後台「發佈新版桌面版」觸發的 GitHub Actions 自動化
  // 流程完全脫鉤——那條線只負責「已安裝使用者的背景自動更新」，跟這個「網站
  // 首次下載」的按鈕互不影響，也不會互相覆蓋。要換掉使用者下載到的安裝檔，
  // 直接換掉 public/downloads/ 裡的這個檔案即可。
  const WIN_DOWNLOAD_URL = "/downloads/MapSky_Installbox.exe";
  // 跟 Windows 那份是同一套手動維護邏輯（見 public/downloads/README.md），
  // 檔名故意跟 Windows 版共用同一個前綴 MapSky_Installbox，只有副檔名不同，
  // 方便一眼看出是同一組安裝檔、只是不同平台。mac 版沒有簽章（沒有 Apple
  // Developer Program 憑證），使用者第一次打開會被 Gatekeeper 擋，需要右鍵
  // 「打開」，下面按鈕點下去之後順便帶一次提示文字說明這件事。
  const MAC_DOWNLOAD_URL = "/downloads/MapSky_Installbox.dmg";

  // 電腦版瀏覽器直接打開網站：一律擋住，逼使用者去下載桌面版，不放行到登入
  // 畫面（也就不會跑 initAuthGate，不會打任何 /api/* ——不是只有畫面被蓋住
  // 而已）。手機瀏覽器（isDesktopWidth 為 false）完全不受影響，跟以前一樣
  // 正常使用；我們自己的 Electron 桌面版本身（window.mapskyWindowControls
  // 存在）也正常放行，不然自己的桌面版會被自己擋住。
  function guardDesktopAppRequired() {
    const isDesktopWidth = window.matchMedia && window.matchMedia("(min-width: 901px)").matches;
    if (!isDesktopWidth) return false;

    const isOwnDesktopApp = Boolean(window.mapskyWindowControls);
    if (isOwnDesktopApp) return false;

    document.addEventListener("DOMContentLoaded", () => {
      const gate = el("desktopAppRequiredGate");
      if (!gate) return;
      gate.classList.remove("hidden");

      const loginGate = el("loginGate");
      if (loginGate) loginGate.classList.add("hidden");

      const btn = el("desktopAppRequiredBtn");
      if (!btn) return;
      const macCmd = el("desktopAppRequiredMacCmd");
      const macCmdCopyBtn = el("desktopAppRequiredMacCmdCopyBtn");

      const platform = navigator.platform || "";
      const ua = navigator.userAgent || "";
      const isMac = /Mac/i.test(platform) || /Macintosh/i.test(ua);
      const isWindows = /Win/i.test(platform) || /Windows/i.test(ua);

      const WIN_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 88 88"><path fill="#ffffff" d="M0 0h42v42H0zM46 0h42v42H46zM0 46h42v42H0zM46 46h42v42H46z"/></svg>';

      if (isWindows) {
        btn.innerHTML = WIN_ICON_SVG + "<span>下載 Windows 版</span><span aria-hidden=\"true\">→</span>";
        btn.disabled = false;
        btn.onclick = () => window.open(WIN_DOWNLOAD_URL, "_blank");
        if (macCmd) macCmd.classList.add("hidden");
      } else if (isMac) {
        const MAC_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 768 768" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="mapskyMacIconClip"><path d="M 53.761719 184 L 690 184 L 690 765 L 53.761719 765 Z M 53.761719 184 "/></clipPath></defs><g clip-path="url(#mapskyMacIconClip)"><path fill="#ffffff" d="M 592.25 405.894531 C 593.871094 488.617188 647.398438 532.410156 676.59375 550.25 C 687.945312 558.359375 692.8125 572.957031 687.945312 585.933594 C 679.835938 607.019531 665.238281 637.835938 640.910156 670.277344 C 608.46875 717.3125 574.410156 762.726562 519.261719 764.347656 C 465.738281 765.972656 449.519531 733.53125 389.503906 733.53125 C 329.492188 733.53125 310.03125 762.726562 259.75 764.347656 C 207.847656 765.972656 167.296875 714.070312 134.859375 667.03125 C 68.359375 572.957031 16.453125 399.410156 86.199219 282.628906 C 120.261719 224.238281 181.894531 186.933594 250.015625 186.933594 C 300.296875 185.308594 348.957031 220.992188 379.773438 220.992188 C 410.589844 220.992188 468.980469 180.445312 530.617188 185.308594 C 553.324219 186.933594 608.46875 193.417969 653.882812 235.589844 C 665.238281 246.945312 665.238281 266.40625 652.261719 277.761719 C 627.933594 300.46875 592.25 342.640625 592.25 405.894531 "/></g><path fill="#ffffff" d="M 491.6875 120.433594 C 514.394531 92.859375 530.617188 57.175781 532.238281 21.492188 C 532.238281 8.515625 522.507812 -1.214844 509.53125 2.027344 C 475.46875 10.136719 438.164062 31.222656 413.835938 57.175781 C 394.371094 83.125 373.285156 120.433594 373.285156 157.738281 C 373.285156 169.089844 383.015625 177.199219 392.75 175.578125 C 431.675781 172.335938 468.980469 149.628906 491.6875 120.433594 "/></svg>';
        btn.innerHTML = MAC_ICON_SVG + "<span>下載 Mac 版</span><span aria-hidden=\"true\">→</span>";
        btn.disabled = false;
        btn.onclick = () => window.open(MAC_DOWNLOAD_URL, "_blank");
        // Mac 版沒有簽章，Gatekeeper 有時候不會給「右鍵打開」這個選項可用
        // （顯示「無法打開，因為 Apple 無法檢查其是否包含惡意軟體」且沒有
        // 例外按鈕），這時候唯一的辦法是打開「終端機」清掉隔離屬性。指令
        // 複製起來直接貼上執行就好，不用自己打、也不用去查路徑對不對。
        if (macCmd) {
          macCmd.classList.remove("hidden");
          if (macCmdCopyBtn) {
            macCmdCopyBtn.onclick = async () => {
              const cmd = "xattr -cr /Applications/MapSky.app";
              try {
                await navigator.clipboard.writeText(cmd);
              } catch {
                // 部分環境（例如不是 https、或使用者還沒跟頁面互動過）
                // clipboard API 會直接丟錯，退回用隱藏 textarea + execCommand
                // 這個舊方法，一樣能把指令複製到剪貼簿。
                const ta = document.createElement("textarea");
                ta.value = cmd;
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                try { document.execCommand("copy"); } catch {}
                document.body.removeChild(ta);
              }
              const original = macCmdCopyBtn.textContent;
              macCmdCopyBtn.textContent = "已複製";
              macCmdCopyBtn.disabled = true;
              setTimeout(() => {
                macCmdCopyBtn.textContent = original;
                macCmdCopyBtn.disabled = false;
              }, 1600);
            };
          }
        }
      } else {
        btn.textContent = "目前僅支援 Windows／Mac 桌面版";
        btn.disabled = true;
        if (macCmd) macCmd.classList.add("hidden");
      }
    });

    return true;
  }

  const blockedByDesktopGate = guardDesktopAppRequired();

  // 手機瀏覽器打開、還沒加到主畫面就先鎖住畫面，逼使用者先加入主畫面
  // （或先換成 Safari）才能繼續用。桌面版（寬螢幕）不受影響，直接放行——
  // 「加入主畫面」本來就是行動裝置的概念，桌面瀏覽器沒有這回事。
  (function guardBrowserGate() {
    const isDesktopWidth = window.matchMedia && window.matchMedia("(min-width: 901px)").matches;
    if (isDesktopWidth) return;

    // Capacitor 包出來的原生 App（iOS／Android 殼）本身就已經是「安裝好」的
    // 狀態，不該再顯示這個給行動瀏覽器看的「加入主畫面／請用 Safari 開啟」
    // 引導畫面（isNativeShell 定義在檔案最上面）。
    if (isNativeShell) return;

    const byMediaQuery = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    const byIosFlag = window.navigator && window.navigator.standalone === true;
    const isStandalone = Boolean(byMediaQuery || byIosFlag);
    if (isStandalone) return;

    const ua = navigator.userAgent || "";
    const isSafari = /^((?!chrome|android|crios|fxios|edgios|opios|opr\/).)*safari/i.test(ua);
    // Android 根本沒有 Safari，跟 Android 使用者說「請用 Safari 開啟」是個
    // 死路（截圖回報過使用者真的卡在這頁出不去）。Android 瀏覽器自己的選單
    // 就能加到主畫面，不需要另一個 App，所以獨立判斷出來，走專屬的說明文字。
    const isAndroid = /android/i.test(ua);

    document.addEventListener("DOMContentLoaded", () => {
      const gate = document.getElementById("browserGate");
      if (!gate) return;
      gate.classList.remove("hidden");

      // 「下載 MapSky」不算首頁本體內容，預設是隱藏的（見 index.html 的
      // class="hidden"），只有網址帶著 #browserGateDownload 時才顯示。
      // 這裡用 hashchange 持續監聽，不是只在剛載入那一刻判斷一次——同一個
      // 分頁內點錨點連結（例如跳去「最新消息」）瀏覽器不會整頁重新載入，
      // 只會換網址的 # 標籤，一次性的判斷不會再執行，區塊顯示出來後就會
      // 卡住收不回去。改成每次 hash 一變就重新判斷要不要顯示，離開
      // #browserGateDownload 時會自動收回去。
      const downloadSection = document.getElementById("browserGateDownload");
      // 從選單或「iOS」平台卡點進來的「下載 MapSky」是開新分頁，使用者會把
      // 這個分頁單獨當成一個「下載頁」用（甚至存起來分享給別人），不是首頁
      // 本體的一部分——原本只是把下載卡片捲到看得見的位置，Hero 大圖／
      // 最新消息／關於 MapSky 那些還留在上面，一打開畫面會先閃一下整個首頁、
      // 捲動時上緣還會露出上一個區塊的字（使用者截圖回報過），看起來很怪。
      // 改成帶著這個 hash 時，其他區塊直接整個隱藏，只留下載卡片，乾淨
      // 單純；離開這個 hash（例如使用者自己把網址改掉）才全部還原。
      const heroSection = document.querySelector(".browser-gate-hero");
      const newsSection = document.getElementById("browserGateNews");
      const aboutSection = document.getElementById("browserGateAbout");
      function syncDownloadSectionVisibility() {
        if (!downloadSection) return;
        const show = window.location.hash === "#browserGateDownload";
        downloadSection.classList.toggle("hidden", !show);
        if (heroSection) heroSection.classList.toggle("hidden", show);
        if (newsSection) newsSection.classList.toggle("hidden", show);
        if (aboutSection) aboutSection.classList.toggle("hidden", show);
        if (show) window.scrollTo({ top: 0 });
      }
      syncDownloadSectionVisibility();
      window.addEventListener("hashchange", syncDownloadSectionVisibility);

      // ---------------- 右上角選單（開合、點項目自動收起、點外面收起）----------------
      const menuBtn = document.getElementById("browserGateMenuBtn");
      const menu = document.getElementById("browserGateMenu");
      if (menuBtn && menu) {
        const closeMenu = () => {
          menu.classList.add("hidden");
          menuBtn.setAttribute("aria-expanded", "false");
        };
        menuBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const willOpen = menu.classList.contains("hidden");
          menu.classList.toggle("hidden", !willOpen);
          menuBtn.setAttribute("aria-expanded", String(willOpen));
        });
        menu.querySelectorAll(".browser-gate-menu-item").forEach((item) => {
          item.addEventListener("click", closeMenu);
        });
        document.addEventListener("click", (e) => {
          if (!menu.classList.contains("hidden") && !menu.contains(e.target) && e.target !== menuBtn) {
            closeMenu();
          }
        });
      }

      // ---------------- 下載區：iOS／Android 分頁 ----------------
      // 預設依偵測到的平台自動選分頁，但使用者還是可以手動點另一個分頁看
      // （例如想幫朋友的 Android 手機查步驟，自己卻是用 iPhone 在看這頁）。
      const tabs = Array.from(document.querySelectorAll(".browser-gate-tab"));
      const panels = {
        ios: document.getElementById("browserGateTabIos"),
        android: document.getElementById("browserGateTabAndroid"),
      };
      function activateTab(platform) {
        tabs.forEach((t) => {
          const active = t.dataset.platform === platform;
          t.classList.toggle("is-active", active);
          t.setAttribute("aria-selected", String(active));
        });
        Object.keys(panels).forEach((key) => {
          if (panels[key]) panels[key].classList.toggle("hidden", key !== platform);
        });
      }
      tabs.forEach((t) => t.addEventListener("click", () => activateTab(t.dataset.platform)));
      activateTab(isAndroid ? "android" : "ios");

      // ---------------- iOS 分頁：分享／複製網址 ----------------
      // 這兩顆按鈕（小圖示 + 下面那顆大的圓角按鈕）都是同一個元件、同一段
      // 分享邏輯，按了會分享 App 連結本身（這個畫面還沒進到主程式，還沒有
      // 城市/天氣資料可以分享）。
      // 提醒：navigator.share() 跳出的系統分享清單不會有「加入主畫面」這個
      // 選項，那個只有
