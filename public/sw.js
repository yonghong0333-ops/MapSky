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

// 收到後端發的公告推播，跳系統通知。
self.addEventListener("push", (event) => {
  let data = { title: "MapSky", body: "", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // 不是 JSON 格式就用預設值，不讓整個 push 事件炸掉
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { url: data.url || "/" },
    })
  );
});

// 點通知：如果已經有分頁開著就切過去，沒有就開新分頁。
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
