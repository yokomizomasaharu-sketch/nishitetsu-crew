const CACHE = 'nishitetsu-crew-v35';
const ASSETS = ['./', './index.html', './style.css', './app.js', './data.js', './stops.js', './manifest.json', './icons/icon-192.png', './assets/track-map.jpg'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // えれサイト4の運用情報はアプリ側でキャッシュ（localStorage）を持つので、SWは素通しにする
  if (e.request.url.indexOf('elesite-next.com') >= 0) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
