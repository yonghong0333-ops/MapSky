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

const { app, BrowserWindow, shell, session } = require("electron");
const path = require("path");

const APP_URL = "https://mapskyapp.vercel.app/";

function createWindow() {
  const win = new BrowserWindow({
    // MapSky 網頁版自己會用 `matchMedia("(min-width: 901px)")` 判斷是不是「桌面」，
    // 沒過門檻就會當成手機瀏覽器，跳出「請用 Safari 開啟／加入主畫面」的提示
    // （這個提示只對手機有意義，桌面版不該看到）。所以這裡預設尺寸、最小尺寸都
    // 抓在 901px 以上，讓網站自己的判斷邏輯正確辨識成桌面，不用另外改網站程式碼。
    width: 1200,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "MapSky 天氣",
    icon: path.join(__dirname, "build-icon.ico"),
    backgroundColor: "#0b1220",
    autoHideMenuBar: true, // 保留選單（重新整理/開發者工具用得到），但預設收起來，貼近一般天氣 App 的簡潔感
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadURL(APP_URL);
  win.once("ready-to-show", () => win.show());

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

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
