// ------------------------------------------------------------------
// electron/preload-login.js —— 專門給登入視窗用的橋接
//
// 登入視窗載入的是 Google/GitHub/…等「外部」網域的真實頁面，不是自己的
// 網站。跟主視窗共用 preload.js 的話，會把縮小/放大、軟體更新（含
// installNow 這種會直接重啟安裝的動作）這些完全用不到、也不該讓外部頁面
// 摸得到的能力一起暴露過去，攻擊面沒必要開這麼大。這裡另外切一份最小化的
// 橋接，只給登入視窗用，永遠只暴露「關閉這個視窗」一個方法。
// ------------------------------------------------------------------

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mapskyLoginControls", {
  close: () => ipcRenderer.send("mapsky:login-window-close"),
});
