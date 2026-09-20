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
  // 向主行程要一次系統定位（呼叫原生小工具）。maxAgeMs 內有快取就直接回傳。
  osPosition: (maxAgeMs) => ipcRenderer.invoke("mapsky:os-position", maxAgeMs || 0),
  // 由外殼查「所在地名稱＋目前天氣」。coords 為 { lat, lon }；傳 null 表示改用 IP 概略定位。
  lookup: (coords) => ipcRenderer.invoke("mapsky:local-weather", coords || null),
});

// ------------------------------------------------------------------
// macOS 定位：把網頁的 navigator.geolocation.getCurrentPosition 換成呼叫原生小工具
//
// Electron 在 macOS 上的 navigator.geolocation 會一直卡住（既不回傳也不報錯，授權視窗也不會
// 跳出來），所以改由主行程執行 MapSkyLocate（CoreLocation 小工具，見 main.js 的
// getOsPosition）。行為：
//   * 第一次：系統跳出「想使用你的位置」授權視窗，使用者按下允許前一直等（最長 10 分鐘），
//     不亂猜、不自動改用 IP 定位。
//   * 按下允許 → 回傳座標，網頁原本的流程照常往下走。
//   * 不允許／系統定位服務關閉 → code 1；取不到座標 → code 2；等太久 → code 3。
//     只有 1、2 是「真的失敗」，才會通知外殼跳出說明視窗。
//   * 這一版沒有小工具（"unsupported"）→ 退回瀏覽器內建的（在 Mac 上大概會卡住，
//     網站自己的逾時流程會接手）。
// 必須在網頁自己的程式執行之前裝好，所以放在 preload（文件一開始就跑），
// 用 webFrame 把這段丟進網頁本身的環境（不是 preload 的隔離環境）。
// ------------------------------------------------------------------
if (process.platform === "darwin") {
  const GEO_SOURCE = `
    (function () {
      if (window.__mapskyGeoWrapped || !navigator.geolocation) return;
      window.__mapskyGeoWrapped = true;
      var geo = navigator.geolocation;
      var orig = geo.getCurrentPosition.bind(geo);
      var reported = false;
      function mkError(code, msg) {
        return { code: code, message: msg, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
      }
      geo.getCurrentPosition = function (ok, fail, opts) {
        var bridge = window.mapskyLocation;
        if (!bridge || !bridge.osPosition) return orig(ok, fail, opts);
        var maxAge = (opts && Number(opts.maximumAge)) || 0;
        bridge.osPosition(maxAge).then(function (r) {
          if (r && r.ok) {
            if (ok) ok({
              coords: { latitude: r.latitude, longitude: r.longitude, accuracy: r.accuracy,
                        altitude: null, altitudeAccuracy: null, heading: null, speed: null },
              timestamp: Date.now()
            });
            return;
          }
          var err = r && r.error;
          if (err === "unsupported") { orig(ok, fail, opts); return; }
          var code = err === "denied" ? 1 : err === "timeout" ? 3 : 2;
          if ((code === 1 || code === 2) && !reported) {
            reported = true;
            try { bridge.reportFailure(code); } catch (e) {}
          }
          if (fail) fail(mkError(code, "MapSky: " + err));
        }).catch(function () {
          if (fail) fail(mkError(2, "MapSky: unavailable"));
        });
      };
    })();
  `;
  try {
    webFrame.executeJavaScript(GEO_SOURCE).catch(() => {});
  } catch (_) { /* 拿不到就維持原本行為，不影響其他功能 */ }
}
