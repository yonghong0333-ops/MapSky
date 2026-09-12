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
