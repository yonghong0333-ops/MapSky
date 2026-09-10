// 最簡單的 Service Worker：目前只用來讓瀏覽器判定「這是一個可安裝的 App」。
// 沒有做離線快取，所有請求照樣直接打網路，行為跟沒有 SW 時一樣，不會影響 API/天氣資料。
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
