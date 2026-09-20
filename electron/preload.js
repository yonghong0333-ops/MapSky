// ------------------------------------------------------------------
// electron/preload.js —— 給自訂標題列用的橋接
//
// 因為開了 contextIsolation + sandbox，載入的網頁本身沒辦法直接呼叫
// win.minimize() 這些原生方法，要透過這裡的 contextBridge 開一個安全的窗口，
// 讓注入到頁面裡的自訂標題列可以喊 window.mapskyWindowControls.xxx()，
// 實際動作還是在主行程（main.js）裡用 ipcMain 處理。
// ------------------------------------------------------------------

const { contextBridge, ipcRenderer, webFrame } = require("electron");

contextBridge.exposeInMainWorld("mapskyWindowControls", {
  minimize: () => ipcRenderer.send("mapsky:window-control", "minimize"),
  maximize: () => ipcRenderer.send("mapsky:window-control", "maximize"),
  close: () => ipcRenderer.send("mapsky:window-control", "close"),
  onMaximizedChange: (callback) => {
    ipcRenderer.on("mapsky:maximized-changed", (_event, isMaximized) => callback(isMaximized));
  },
});

// 軟體本身（.exe）的自動更新橋接：electron-updater 在背景抓、在背景下載，
// 下載完成後由 main.js 通知注入的標題列彈提示條；使用者按「立即重新啟動
// 安裝」或倒數結束，頁面呼叫 installNow()，實際的 autoUpdater.quitAndInstall()
// 還是在主行程做。
contextBridge.exposeInMainWorld("mapskyAppUpdate", {
  installNow: () => ipcRenderer.send("mapsky:install-update"),
  getVersion: () => ipcRenderer.invoke("mapsky:get-version"),
  getChannel: () => ipcRenderer.invoke("mapsky:get-update-channel"),
  setChannel: (channel) => ipcRenderer.send("mapsky:set-update-channel", channel),
  onUpdateAvailable: (callback) => {
    ipcRenderer.on("mapsky:update-available", (_event, info) => callback(info));
  },
  onDownloaded: (callback) => {
    ipcRenderer.on("mapsky:update-downloaded", (_event, version) => callback(version));
  },
});

// 定位失敗回報（macOS）：main.js 注入的 getCurrentPosition 包裝在定位失敗時呼叫這個，
// 由主行程跳出說明並引導使用者到系統設定開啟定位服務。
contextBridge.exposeInMainWorld("mapskyLocation", {
  reportFailure: (code) => ipcRenderer.send("mapsky:location-failed", code),
  // 由外殼查「所在地名稱＋目前天氣」。coords 為 { lat, lon }；傳 null 表示改用 IP 概略定位。
  lookup: (coords) => ipcRenderer.invoke("mapsky:local-weather", coords || null),
});

// ------------------------------------------------------------------
// macOS 定位：等使用者在系統的「定位權限」視窗按下允許，再開始偵測
//
// 第一次讀定位時 macOS 會跳出「MapSky 想使用你的位置」。網站原本只等 15 秒（標題列 8 秒），
// 使用者還在看視窗、還沒按，程式就當成「失敗」，改用 IP 定位隨便挑一個縣市（在台灣常常
// 判成台北），還會誤跳「無法取得定位」的說明。這裡把等待時間拉長到 10 分鐘：
//   * 使用者還沒回答 → 一直等，不亂猜、不自動改用 IP 定位。
//   * 按下允許 → 系統把座標交回來，網站原本的流程照常往下走。
//   * 按下不允許／系統定位服務關閉 → 立刻回報失敗（code 1／2），網站才改用 IP 定位，
//     外殼也才跳出說明視窗、引導到系統設定開啟。「逾時」不算失敗，不會跳說明。
// 必須在網頁自己的程式執行之前裝好，所以放在 preload（文件一開始就跑），
// 用 webFrame 把這段丟進網頁本身的環境（不是 preload 的隔離環境）。
// ------------------------------------------------------------------
if (process.platform === "darwin") {
  const GEO_WAIT_SOURCE = `
    (function () {
      if (window.__mapskyGeoWrapped || !navigator.geolocation) return;
      window.__mapskyGeoWrapped = true;
      var geo = navigator.geolocation;
      var orig = geo.getCurrentPosition.bind(geo);
      var reported = false;
      var LONG_WAIT_MS = 10 * 60 * 1000;
      geo.getCurrentPosition = function (ok, fail, opts) {
        var o = Object.assign({}, opts || {});
        o.timeout = LONG_WAIT_MS;
        return orig(ok, function (err) {
          if (err && (err.code === 1 || err.code === 2) && !reported) {
            reported = true;
            try { if (window.mapskyLocation) window.mapskyLocation.reportFailure(err.code); } catch (e) {}
          }
          if (fail) fail(err);
        }, o);
      };
    })();
  `;
  try {
    webFrame.executeJavaScript(GEO_WAIT_SOURCE).catch(() => {});
  } catch (_) { /* 拿不到就維持原本行為，不影響其他功能 */ }
}
