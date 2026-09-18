# 這個資料夾放什麼

網站的「下載 Windows 版」按鈕直接連到這裡的 `MapSky_Installbox.exe`，網址是：

    https://mapskyapp.vercel.app/downloads/MapSky_Installbox.exe

「下載 Mac 版」按鈕（訪客用 Mac 打開網站時會自動切換成這顆按鈕）連到這裡的
`MapSky_Installbox.dmg`，網址是：

    https://mapskyapp.vercel.app/downloads/MapSky_Installbox.dmg

這兩個檔案都是**手動維護**的，跟後台「發佈新版桌面版」觸發的 GitHub Actions
自動化流程完全無關——那條線只負責幫已安裝的使用者做背景自動更新，不會
動到這個資料夾裡的檔案，兩邊不會互相覆蓋。**更新（2026-09-18）：`MapSky_Installbox.dmg` 改用導向方式提供，不再直接放在
這個資料夾裡。** 原因是這個檔案目前約 170MB，超過 GitHub 對單一 git 檔案的
100MB 硬性上限，沒辦法像 `.exe` 一樣直接 commit 進 repo。改成：檔案本體上傳到
一個專門的 GitHub Release（tag：`downloads-mac-installer`），`vercel.json`
裡加了一條 redirect，把 `/downloads/MapSky_Installbox.dmg` 導到該 Release
的附件網址。網站按鈕本身（`web-shim.js` 裡的 `MAC_DOWNLOAD_URL`）完全沒有
改動，因為那個相對路徑本來就是靠 Vercel 解析，現在只是多一層轉址。

## 之後要換掉 Mac 版安裝檔，怎麼做

去這個 Release 頁面：
`https://github.com/yonghong0333-ops/MapSky/releases/edit/downloads-mac-installer`
把新的 `MapSky_Installbox.dmg` 拖上去覆蓋掉舊的附件（檔名要完全一樣），存檔
即可，`vercel.json` 不用再改，因為 redirect 目標網址不會變。

Mac 版**沒有簽章**（沒有申請 Apple Developer Program，年費 US$99），使用者
第一次打開會被 Gatekeeper 擋住，畫面會顯示「無法打開，因為 Apple 無法檢查
其是否包含惡意軟體」，需要在 App 上按右鍵（或 Control + 點擊）→「打開」，
或執行 `xattr -cr /Applications/MapSky.app`。網站上「下載 Mac 版」按鈕旁邊
已經有一行小字提醒這件事。

## 要換掉使用者下載到的安裝檔，怎麼做

**方法一：直接在 GitHub 網頁上傳（不用 git、不用 token）**
1. 打開這個資料夾在 GitHub 上的頁面：
   `https://github.com/yonghong0333-ops/MapSky/tree/main/public/downloads`
2. 點 **Add file → Upload files**
3. 把你包好的安裝檔拖進去，**檔名務必存成 `MapSky_Installbox.exe`（Windows）或
   `MapSky_Installbox.dmg`（Mac）**，跟網站按鈕寫死抓的檔名一致（上傳同名檔案
   會直接取代舊檔案）
4. 最下面填一下 commit message，選 **Commit directly to the `main` branch**
5. 存檔後，Vercel 通常會自動重新部署；如果沒有，去 Vercel 的 Deployments
   分頁手動 Redeploy 一次

**方法二：傳給我，我幫你 commit + push**
把安裝檔當附件傳給我，我放進這個資料夾、commit 好，跟你要一組有 `repo`
權限的 token 幫你 push 上去。

檔名一定要對：Windows 版是 `MapSky_Installbox.exe`、Mac 版是
`MapSky_Installbox.dmg`，網站按鈕是寫死抓這兩個檔名，改了別的名字按鈕會抓
不到。GitHub Actions 建出來的檔案（`.github/workflows/build-desktop.yml`）
本身已經是這個檔名了（package.json 裡 `artifactName` 設定的），從 Release
頁面下載下來直接原檔名上傳到這裡即可，不用改名。
