// 社内チャット Service Worker（ネットワーク優先＝更新が即反映される）
const CACHE = 'shanai-chat-v4';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/logo.png', '/manifest.json', '/icon-192.png', '/icon-512.png'];

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
  if (url.origin !== self.location.origin) return; // 外部はそのまま
  // API・アップロード・WebSocketは常にネットワーク（キャッシュしない）
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/socket.io/')) return;
  // 静的資産はネットワーク優先（最新を取得。失敗時＝オフラインのみキャッシュ）
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok) { const clone = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, clone)); }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
