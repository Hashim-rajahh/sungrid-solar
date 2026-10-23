// SunGrid Solar service worker: precaches the whole app shell so it loads with no network.
//
// IMPORTANT: when you change any file listed in SHELL, bump VERSION. The new worker then
// installs a fresh cache and the activate step deletes the old one. (See README, "Decision log".)

const VERSION = 'sungrid-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/data.js',
  './js/quote.js',
  './js/router.js',
  './js/util.js',
  './js/views.js',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sungrid-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Page loads: always serve the cached shell (the app is a single page), so any deep link works offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached || fetch(request)).catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Everything else: cache first, fall back to network, and remember what we fetched.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
