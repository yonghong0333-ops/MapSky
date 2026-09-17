# 這個資料夾放什麼

網站的「下載 Windows 版」按鈕直接連到這裡的 `MapSky_Installbox.exe`，網址是：

    https://mapskyapp.vercel.app/downloads/MapSky_Installbox.exe

這個檔案是**手動維護**的，跟後台「發佈新版桌面版」觸發的 GitHub Actions
自動化流程完全無關——那條線只負責幫已安裝的使用者做背景自動更新，不會
動到這個資料夾裡的檔案，兩邊不會互相覆蓋。

## 要換掉使用者下載到的安裝檔，怎麼做

**方法一：直接在 GitHub 網頁上傳（不用 git、不用 token）**
1. 打開這個資料夾在 GitHub 上的頁面：
   `https://github.com/yonghong0333-ops/MapSky/tree/main/public/downloads`
2. 點 **Add file → Upload files**
3. 把你包好的安裝檔拖進去，**檔名務必存成 `MapSky_Installbox.exe`**（跟現有的同名，
   上傳時會直接取代舊檔案）
4. 最下面填一下 commit message，選 **Commit directly to the `main` branch**
5. 存檔後，Vercel 通常會自動重新部署；如果沒有，去 Vercel 的 Deployments
   分頁手動 Redeploy 一次

**方法二：傳給我，我幫你 commit + push**
把安裝檔當附件傳給我，我放進這個資料夾、commit 好，跟你要一組有 `repo`
權限的 token 幫你 push 上去。

檔名一定要是 `MapSky_Installbox.exe`，網站按鈕是寫死抓這個檔名，改了別的名字
按鈕會抓不到。
