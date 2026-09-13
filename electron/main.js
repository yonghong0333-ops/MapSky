// ------------------------------------------------------------------
// electron/main.js —— 桌面版主行程
//
// 這個桌面版本身不含任何後端邏輯（沒有天氣資料、OAuth、Redis 那些），
// 純粹是一個載入線上 MapSky（https://mapskyapp.vercel.app）的原生視窗殼。
// 所有 API 呼叫、OAuth 登入都還是打去 Vercel 上的正式站台，金鑰留在
// 伺服器端，桌面安裝檔裡不會包到任何機密資料。
//
// 之所以選這個做法而不是把 public/ 資料夾整包塞進安裝檔本地執行，是
// 因為看了 api/auth 的程式碼後發現：OAuth 供應商（Google/GitHub/…）的
// 「Authorized redirect URI」都是寫死指向 https://mapskyapp.vercel.app/api/auth/callback，
// 登入完成後 Provider 一定會把使用者導回這個正式網域、Set-Cookie 也是
// 掛在這個網域下。如果桌面版改成載入「本地打包的前端 + 只轉發 /api 的
// reverse proxy」，畫面雖然一開始是本地檔案，但登入完成那一刻使用者
// 會被導到 mapskyapp.vercel.app（因為 Provider 只認得這個網址），session
// cookie 也會掛在那個網域、不會回到本地殼上，等於登入完卡住或要重新
// 導覽一次，體驗會很怪。直接讓桌面殼從頭到尾都载入正式網域，就完全
// 沒有這個落差，登入流程跟網頁版一模一樣。
// ------------------------------------------------------------------

const { app, BrowserWindow, shell, session, screen, net, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const APP_URL = "https://mapskyapp.vercel.app/";
const APP_ORIGIN = new URL(APP_URL).origin;

// 自訂標題列的高度（隱藏系統原生框之後，這段空間由我們自己畫）。
const TITLEBAR_HEIGHT = 36;

// 多久檢查一次網站是不是有新版本。
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 分鐘
// 提示條倒數幾秒後自動重新整理。
const UPDATE_TOAST_COUNTDOWN_SECONDS = 10;

// Electron 預設 UA 尾巴會帶「Electron/版本號」，某些服務（尤其 Google OAuth）
// 看到這種內嵌瀏覽器字樣會擋掉或降級成舊版頁面。統一換成一般桌面版 Chrome 的
// UA（版本號用這個 Electron 內建的實際 Chromium 版本），主視窗、登入視窗都套用。
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

// 用 HEAD 請求拿首頁的 ETag / Last-Modified 當「版本指紋」。網站的 index.html
// 本來就設了 Cache-Control: no-cache, must-revalidate，Vercel 對靜態檔案照慣例
// 會回 ETag，內容一變這個值就會跟著變，不用額外改後端、也不用整包抓下來比對。
function fetchVersionTag() {
  return new Promise((resolve) => {
    const request = net.request({ method: "HEAD", url: APP_URL });
    request.on("response", (response) => {
      const etag = response.headers["etag"];
      const lastModified = response.headers["last-modified"];
      const tag = etag || lastModified || null;
      resolve(Array.isArray(tag) ? tag[0] : tag);
    });
    request.on("error", () => resolve(null));
    request.end();
  });
}

// 在畫面右下角插一條「發現新版本」提示條：倒數 10 秒沒動作就自動重新整理，
// 也可以按「重新整理」馬上刷新，或按「稍後再說」先關掉（之後如果偵測到還是
// 舊版本，下一輪檢查會再提示一次）。純粹用注入的 JS/CSS 畫出來，不用改
// 網站本身的程式碼。
function showUpdateToast(win) {
  if (win.isDestroyed()) return;
  const script = `
    (function () {
      if (document.getElementById("__mapsky_update_toast__")) return;
      var seconds = ${UPDATE_TOAST_COUNTDOWN_SECONDS};

      var el = document.createElement("div");
      el.id = "__mapsky_update_toast__";
      el.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;" +
        "background:#111827;color:#fff;padding:14px 16px;border-radius:14px;" +
        "box-shadow:0 10px 30px rgba(0,0,0,.35);font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
        "display:flex;flex-direction:column;gap:10px;max-width:300px;";

      var msg = document.createElement("div");
      msg.innerHTML = "發現新版本，<b id='__mapsky_update_countdown__'>" + seconds + "</b> 秒後自動重新整理";
      el.appendChild(msg);

      var row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

      var reloadBtn = document.createElement("button");
      reloadBtn.textContent = "重新整理";
      reloadBtn.style.cssText = "background:#3b82f6;color:#fff;border:none;padding:6px 14px;" +
        "border-radius:8px;cursor:pointer;font-weight:600;font-size:13px;";

      var laterBtn = document.createElement("button");
      laterBtn.textContent = "稍後再說";
      laterBtn.style.cssText = "background:transparent;color:#cbd5e1;border:1px solid #475569;" +
        "padding:6px 14px;border-radius:8px;cursor:pointer;font-size:13px;";

      row.appendChild(laterBtn);
      row.appendChild(reloadBtn);
      el.appendChild(row);
      document.body.appendChild(el);

      var timer = setInterval(function () {
        seconds -= 1;
        var c = document.getElementById("__mapsky_update_countdown__");
        if (c) c.textContent = String(seconds);
        if (seconds <= 0) {
          clearInterval(timer);
          location.reload();
        }
      }, 1000);

      reloadBtn.onclick = function () {
        clearInterval(timer);
        location.reload();
      };
      laterBtn.onclick = function () {
        clearInterval(timer);
        el.remove();
      };
    })();
  `;
  win.webContents.executeJavaScript(script).catch(() => {});
}

// 讀一次 logo，轉成 base64 內嵌進注入的 HTML 裡——標題列是插進「別人網域」的
// 頁面裡，用 file:// 路徑當 <img src> 在 https 頁面裡會被當成混合內容擋掉，
// 用 data: URI 就沒有這個問題。
let cachedLogoDataUri = null;
function getLogoDataUri() {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  try {
    const buf = fs.readFileSync(path.join(__dirname, "icons", "app-logo.png"));
    cachedLogoDataUri = `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    cachedLogoDataUri = "";
  }
  return cachedLogoDataUri;
}

// 隱藏系統原生標題列之後（frame:false），自己畫一列貼合 App 深色風格的標題列：
// 左邊 App 圖示＋名稱，右邊縮小／放大還原／關閉三顆圓形圖示鈕，深色圓角卡片
// 風格。整段用注入的 HTML/CSS/JS 畫出來，不用改網站本身的程式碼；每次頁面
// （重新）載入完都要重插一次，因為 reload 會把注入的東西一起洗掉。
function injectTitleBar(win) {
  if (win.isDestroyed()) return;
  const logoDataUri = getLogoDataUri();
  const script = `
    (function () {
      if (document.getElementById("__mapsky_titlebar__")) return;

      var bar = document.createElement("div");
      bar.id = "__mapsky_titlebar__";
      bar.style.cssText = "position:fixed;top:0;left:0;right:0;height:${TITLEBAR_HEIGHT}px;" +
        "background:#15171c;color:#cbd5e1;display:flex;align-items:center;" +
        "justify-content:space-between;z-index:2147483647;padding:0 8px 0 14px;" +
        "box-sizing:border-box;border-radius:14px 14px 0 0;" +
        "font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
        "-webkit-app-region:drag;user-select:none;";

      var left = document.createElement("div");
      left.style.cssText = "display:flex;align-items:center;gap:9px;overflow:hidden;";
      left.innerHTML = ${JSON.stringify('<img src="' + logoDataUri + '" style="width:20px;height:20px;border-radius:6px;display:block;" />')} +
        "<span style='white-space:nowrap;font-weight:600;color:#e5e7eb;'>MapSky 天氣</span>";

      var right = document.createElement("div");
      right.style.cssText = "display:flex;align-items:center;gap:6px;-webkit-app-region:no-drag;";

      var ICONS = {
        minimize: '<svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        maximize: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
        restore: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="2.6" width="6" height="6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.1"/><rect x="3" y="0.6" width="6" height="6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
        close: '<svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
      };

      // 圓形圖示鈕，跟參考圖裡那排格狀選單/通知/設定鈕同一種風格：
      // 深色底、淺灰圖示，滑過時背景亮一點（關閉鈕滑過變紅）。
      function makeBtn(iconSvg, danger) {
        var b = document.createElement("button");
        b.innerHTML = iconSvg;
        b.style.cssText = "width:28px;height:28px;padding:0;margin:0;box-sizing:border-box;" +
          "border:none;border-radius:50%;font-size:0;line-height:0;" +
          "background:rgba(255,255,255,.06);color:#cbd5e1;cursor:pointer;" +
          "display:flex;align-items:center;justify-content:center;flex-shrink:0;" +
          "transition:background .12s ease;";
        b.onmouseenter = function () {
          b.style.background = danger ? "#dc2626" : "rgba(255,255,255,.14)";
          b.style.color = "#fff";
        };
        b.onmouseleave = function () {
          b.style.background = "rgba(255,255,255,.06)";
          b.style.color = "#cbd5e1";
        };
        return b;
      }

      var minBtn = makeBtn(ICONS.minimize, false);
      var maxBtn = makeBtn(ICONS.maximize, false);
      var closeBtn = makeBtn(ICONS.close, true);

      minBtn.onclick = function () { window.mapskyWindowControls.minimize(); };
      maxBtn.onclick = function () { window.mapskyWindowControls.maximize(); };
      closeBtn.onclick = function () { window.mapskyWindowControls.close(); };

      right.appendChild(minBtn);
      right.appendChild(maxBtn);
      right.appendChild(closeBtn);

      bar.appendChild(left);
      bar.appendChild(right);
      document.documentElement.appendChild(bar);

      // 幫整份文件往下推，剛好空出標題列的高度，避免蓋到原本的畫面內容
      // （視窗本身在建立時已經多加了這段高度，所以不會因此多出捲軸）。
      var pushStyle = document.createElement("style");
      pushStyle.textContent = "html{margin-top:${TITLEBAR_HEIGHT}px !important;}";
      document.head.appendChild(pushStyle);

      if (window.mapskyWindowControls && window.mapskyWindowControls.onMaximizedChange) {
        window.mapskyWindowControls.onMaximizedChange(function (isMaximized) {
          maxBtn.innerHTML = isMaximized ? ICONS.restore : ICONS.maximize;
        });
      }
    })();
  `;
  win.webContents.executeJavaScript(script).catch(() => {});
}

// 背景檢查有沒有新版本：抓到跟上次不一樣的 ETag/Last-Modified 就跳提示條
// （不管視窗當下在不在前景，反正只是畫面角落一條小提示，不會打斷操作）。
function watchForUpdates(win) {
  let lastTag = null;

  const check = async () => {
    if (win.isDestroyed()) return;
    const tag = await fetchVersionTag();
    if (!tag) return; // 拿不到指紋（例如網路暫時不通）就跳過這次，不誤判有更新
    if (lastTag && tag !== lastTag) {
      showUpdateToast(win);
    }
    lastTag = tag;
  };

  check(); // 開機先記一次基準值
  const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  win.on("closed", () => clearInterval(timer));
}

// 登入按鈕在網頁裡是普通的 <a href="/api/auth/login?provider=...">，不是
// window.open 開新分頁，所以預設會直接在主視窗裡導覽過去、繞去 Google/GitHub/
// …等登入頁，登入完再繞回來。這裡改成攔截這個連結，改用另一個獨立視窗跑完
// 整個登入流程，主視窗全程留在 App 畫面上，跟大部分桌面 App「登入另開視窗」
// 的體驗一致。
function isLoginUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.origin === APP_ORIGIN && u.pathname === "/api/auth/login";
  } catch {
    return false;
  }
}

// 判斷「登入流程是不是跑完了」——OAuth 供應商登入完一定會導回
// /api/auth/callback，這才是登入完成的訊號（session cookie 這時候已經設好）。
// 不能只看「是不是回到自己網域」，因為登入視窗一開始載入的
// /api/auth/login 本身就是自己網域，會誤判成一開始就登入完成。
function isCallbackUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.origin === APP_ORIGIN && u.pathname.startsWith("/api/auth/callback");
  } catch {
    return false;
  }
}

// 每個登入視窗都換成當時登入的那家公司 logo（跟網頁版登入按鈕用的圖是同一份），
// 而不是整個都用 MapSky 自己的圖示，比較看得出來現在是在登入哪個帳號。
const PROVIDER_ICON = {
  google: "google.png",
  facebook: "facebook.png",
  microsoft: "microsoft.png",
  discord: "discord.png",
  github: "github.png",
  yahoo: "yahoo.png",
};

function getProviderIconPath(urlStr) {
  try {
    const provider = new URL(urlStr).searchParams.get("provider");
    const file = PROVIDER_ICON[provider];
    return file ? path.join(__dirname, "icons", file) : path.join(__dirname, "build-icon.ico");
  } catch {
    return path.join(__dirname, "build-icon.ico");
  }
}

function openLoginWindow(parentWin, loginUrl) {
  const loginWin = new BrowserWindow({
    width: 480,
    height: 720,
    parent: parentWin,
    modal: true,
    title: "登入 MapSky",
    icon: getProviderIconPath(loginUrl),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Electron 視窗預設的 User-Agent 尾巴會帶一段「Electron/版本號」，Google 的
  // OAuth 登入頁看到這種內嵌瀏覽器的 UA 會直接判定不安全，跳出閹割過的舊版
  // 登入頁（甚至直接擋掉），不是給一般瀏覽器看的那個正常畫面。換成一般桌面版
  // Chrome 的 UA，登入頁才會正常顯示成目前的樣子。
  loginWin.webContents.setUserAgent(CHROME_UA);

  loginWin.loadURL(loginUrl);

  let finished = false;
  const checkDone = (url) => {
    if (finished || !isCallbackUrl(url)) return;
    finished = true;
    loginWin.close();
    if (!parentWin.isDestroyed()) parentWin.webContents.reload();
  };

  loginWin.webContents.on("will-navigate", (_event, url) => checkDone(url));
  loginWin.webContents.on("will-redirect", (_event, url) => checkDone(url));
  loginWin.webContents.on("did-navigate", (_event, url) => checkDone(url));
}

function createWindow() {
  // 依照使用者螢幕解析度算一個合理的視窗大小（小筆電開小一點、大螢幕開大一點），
  // 而不是寫死固定尺寸。
  //   下限 960x640 —— 寬度一定要超過網站判斷「桌面版」的 901px 門檻（見下面），
  //   不然會誤跳手機版「加入主畫面」提示。
  //   上限 1600x1000 —— App 內容本身是偏窄的單欄卡片式版面，視窗開太大兩側只會
  //   留一堆空白，沒有意義。
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = Math.min(Math.max(Math.round(screenWidth * 0.65), 960), 1600);
  const winHeight = Math.min(Math.max(Math.round(screenHeight * 0.85), 640), 1000);

  const win = new BrowserWindow({
    // MapSky 網頁版自己會用 `matchMedia("(min-width: 901px)")` 判斷是不是「桌面」，
    // 沒過門檻就會當成手機瀏覽器，跳出「請用 Safari 開啟／加入主畫面」的提示
    // （這個提示只對手機有意義，桌面版不該看到）。所以這裡預設尺寸、最小尺寸都
    // 抓在 901px 以上，讓網站自己的判斷邏輯正確辨識成桌面，不用另外改網站程式碼。
    width: winWidth,
    height: winHeight + TITLEBAR_HEIGHT,
    minWidth: 960,
    minHeight: 640 + TITLEBAR_HEIGHT,
    title: "MapSky 天氣",
    icon: path.join(__dirname, "build-icon.ico"),
    backgroundColor: "#0b1220",
    frame: false, // 隱藏系統原生標題列，改用注入的自訂標題列（見 injectTitleBar）
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.webContents.setUserAgent(CHROME_UA);

  // 每次開軟體都保證是打網路拿最新內容，不要讓本地磁碟快取搶答
  // （index.html 本來就設了 no-cache/must-revalidate，這裡是保險再做一次）。
  win.webContents.session.clearCache().finally(() => {
    win.loadURL(APP_URL);
  });
  win.once("ready-to-show", () => win.show());

  // 自訂標題列的 DOM 是注入進去的，每次頁面（重新）載入完都要重插一次，
  // 不然 reload/導覽一次就被洗掉了。
  win.webContents.on("did-finish-load", () => injectTitleBar(win));

  // 把視窗「有沒有最大化」的狀態轉發給頁面，讓標題列的放大/還原鈕圖示能對上。
  win.on("maximize", () => win.webContents.send("mapsky:maximized-changed", true));
  win.on("unmaximize", () => win.webContents.send("mapsky:maximized-changed", false));

  // App 開著的時候背景檢查有沒有新版本，有的話跳出倒數提示條，
  // 不用整個重開軟體才吃得到最新版本。
  watchForUpdates(win);

  // 點「使用 OO 登入」時，不要讓主視窗整個導覽去 Google/GitHub 這些登入頁，
  // 改開一個獨立的登入視窗去跑，主視窗全程留在 App 畫面。
  win.webContents.on("will-navigate", (event, url) => {
    if (isLoginUrl(url)) {
      event.preventDefault();
      openLoginWindow(win, url);
    }
  });

  // 頁面裡任何「開新分頁」的連結（例如分享、外部說明連結）都改用系統瀏覽器開，
  // 不要在 App 裡再開一個 Electron 視窗。
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}

app.whenReady().then(() => {
  // App 有「自動定位目前位置」功能，桌面版也要能拿到定位權限；
  // 通知權限則是給之後可能要接的天氣警特報推播用。
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "geolocation" || permission === "notifications");
  });

  // 自訂標題列的縮小／放大／關閉鈕實際動作：注入的頁面透過 preload.js 暴露的
  // window.mapskyWindowControls 送 IPC 過來，這裡才是真的呼叫原生視窗方法的地方。
  ipcMain.on("mapsky:window-control", (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (action === "minimize") win.minimize();
    else if (action === "maximize") {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === "close") win.close();
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
