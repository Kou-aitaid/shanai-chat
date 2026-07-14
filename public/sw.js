// 社内チャット Service Worker（基本キャッシュ＝#21）
const CACHE = 'shanai-chat-v1';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/logo.svg', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // API・アップロード・WebSocketは常にネットワーク（キャッシュしない）
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/socket.io/')) return;
  // 静的資産はキャッシュ優先＋バックグラウンド更新（stale-while-revalidate）
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const net = fetch(e.request).then((res) => {
        if (res && res.ok) { const clone = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, clone)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
