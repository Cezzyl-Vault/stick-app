// Service Worker: hält alle App-Dateien offline bereit.
// Strategie: erst Netzwerk (immer aktuell), bei fehlender Verbindung aus dem Cache.
// Bei jeder Veröffentlichung VERSION erhöhen.
const VERSION = 'stickapp-v1';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/color.js',
  './js/config.js',
  './js/crop.js',
  './js/export.js',
  './js/image.js',
  './js/palette-editor.js',
  './js/pattern.js',
  './js/quantize.js',
  './js/render.js',
  './js/storage.js',
  './js/sync.js',
  './js/threads.js',
  './js/worker.js',
  './data/dmc.js',
  './vendor/jspdf.umd.min.js',
  './vendor/supabase.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase & Co. nicht anfassen

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
