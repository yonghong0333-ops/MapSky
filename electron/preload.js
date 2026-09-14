// ------------------------------------------------------------------
// electron/preload.js —— 給自訂標題列用的橋接
//
// 因為開了 contextIsolation + sandbox，載入的網頁本身沒辦法直接呼叫
// win.minimize() 這些原生方法，要透過這裡的 contextBridge 開一個安全的窗口，
// 讓注入到頁面裡的自訂標題列可以喊 window.mapskyWindowControls.xxx()，
// 實際動作還是在主行程（main.js）裡用 ipcMain 處理。
// ------------------------------------------------------------------

const { contextBridge, ipcRenderer } = require("electron");

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
