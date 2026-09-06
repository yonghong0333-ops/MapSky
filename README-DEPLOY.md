# MapSky 網頁版 —— 部署說明

這是把原本 Electron 版「晴雨情報 WeatherPro」(apps/weather) 轉成的網頁版，
架構：**靜態前端（/public）+ Vercel Serverless Functions（/api）**，並新增 OAuth 登入
（Google / Facebook / Microsoft / GitHub / Discord / Yahoo）。

**未登入無法使用**：開啟網頁會先看到全螢幕登入畫面（`public/index.html` 裡的
`#loginGate`），只有登入成功、`/api/auth/session` 確認有效 session 後，
`web-shim.js` 才會動態載入 `renderer.js`、開始輪詢，主畫面（`.app`）也才會顯示出來。
`/api/weather/*` 這幾支 API 本身也各自檢查 session（見 `api/_lib/require-session.js`），
沒登入直接呼叫會拿到 `401`，所以不是只有前端擋畫面而已。

## ⚠️ 部署前必做：重新產生 OAuth 密鑰

原本 zip 檔裡 `launcher/auth/providers.js` 寫死了各家平台的真實 `clientSecret`。
這幾組密鑰已經外流（出現在你上傳的檔案裡），**部署網頁版之前請先去下列各平台
把對應的 App 密鑰「重新產生」一次**，不要沿用舊的：

- Google: https://console.cloud.google.com/apis/credentials
- Facebook: https://developers.facebook.com/apps
- Microsoft (Azure AD): https://portal.azure.com （App registrations → Certificates & secrets）
- GitHub: https://github.com/settings/developers
- Discord: https://discord.com/developers/applications
- Yahoo: https://developer.yahoo.com/apps/

新密鑰只填在 Vercel 的環境變數裡，絕對不要再寫進程式碼或提交進 Git。

## 檔案結構

```
web/
├── api/
│   ├── auth/
│   │   ├── login.js       GET  /api/auth/login?provider=xxx      → 導去該平台登入頁
│   │   ├── callback.js    GET  /api/auth/callback?provider=xxx   → 換 token、建立 session
│   │   ├── session.js     GET  /api/auth/session                 → 前端查目前登入狀態
│   │   ├── logout.js      POST /api/auth/logout                  → 登出
│   │   └── providers.js   GET  /api/auth/providers                → 哪幾家已設定好
│   ├── weather/
│   │   ├── status.js      GET  /api/weather/status      → CWA 金鑰是否已設定
│   │   ├── city.js        GET  /api/weather/city?label=臺北市
│   │   ├── all.js         GET  /api/weather/all
│   │   ├── alerts.js      GET  /api/weather/alerts       → 颱風警報／大雨特報
│   │   └── typhoon.js     GET  /api/weather/typhoon       → 颱風暴風圈侵襲機率
│   └── _lib/              共用邏輯（provider 設定、JWT session、CWA 資料處理、
│                          require-session.js 檔案給 weather/* 用來擋未登入請求）
├── public/                 靜態前端（原 apps/weather 的 index.html / renderer.js / style.css
│                            幾乎原封不動搬過來，只多了 web-shim.js、登入畫面 #loginGate
│                            和對應樣式；renderer.js 改成登入成功後才動態載入）
├── package.json
├── vercel.json
└── .env.example            要設定的環境變數清單
```

**renderer.js 完全沒有改動**——原本它是透過 `window.weatherAPI`（Electron IPC）拿資料，
現在改由 `public/web-shim.js` 在 renderer.js 載入前，用同樣的介面但改成 `fetch()`
呼叫 `/api/weather/*`，所以天氣邏輯、地圖、收藏城市等功能維持原樣。

## 部署到 Vercel

1. 把 `web/` 這個資料夾推到一個 Git repo（GitHub/GitLab/Bitbucket 都可以）。
2. 到 https://vercel.com/new 匯入這個 repo，Framework Preset 選 "Other"（zero-config，
   Vercel 會自動辨識 `/public` 是靜態檔案、`/api/*.js` 是 serverless functions）。
3. 部署前先在 Vercel 專案的 **Settings → Environment Variables** 貼上 `.env.example`
   列出的每一個變數（至少要有 `SESSION_SECRET` 跟 `CWA_API_KEY` 才能開始用；
   OAuth 的部分，哪一家沒填 `clientId`/`clientSecret`，登入列上那個按鈕就會顯示成
   disabled，其他家不受影響）。
4. 第一次部署完成後，會拿到一個網域，例如 `https://your-app.vercel.app`。
   回到各家 OAuth 平台的後台，把 Redirect URI 精確填成：
   ```
   https://your-app.vercel.app/api/auth/callback?provider=<google|facebook|microsoft|github|discord|yahoo>
   ```
   （六家要各自設定一次，`<...>` 換成對應的 provider id）
5. 之後每次 `git push` 到主分支，Vercel 會自動重新部署。

### 本機測試

```bash
npm install -g vercel   # 只需要裝一次
cd web
cp .env.example .env    # 填好裡面的值
vercel dev               # 會在 http://localhost:3000 開發模式跑起來（含 /api）
```

## 這次沒有搬過來的部分

依照你選的範圍（只要天氣 App 單頁網站），下列原本在 `launcher/`（啟動器首頁、
軟體多選、後台管理員白名單、GitHub 自動更新等）沒有搬進網頁版：

- 啟動器首頁 / 多軟體 Tile 選單
- `admin-whitelist.js` 管理員白名單、後台管理畫面
- `update/` 自動更新機制（網頁本來就不需要，重新整理就是最新版）
- CWA 金鑰原本是「管理員在後台改、寫回 GitHub repo」這一整套（`weather-config-store.js`），
  網頁版簡化成直接讀 Vercel 環境變數 `CWA_API_KEY`

如果之後想把整個啟動器首頁也搬上網頁版（例如未來要加第二款 App），或想要
「多個使用者各自的收藏城市存在雲端而不是各自瀏覽器的 localStorage」，這些都可以再擴充，
跟我說一聲即可。
