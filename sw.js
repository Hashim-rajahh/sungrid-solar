// SunGrid Solar service worker: saves the whole app on the device so it opens with no signal.
//
// VERSION is stamped automatically from the content of every cached file: run `npm run stamp`
// after changing any file in SHELL. A test fails if the stamp is stale, so it cannot be forgotten.
//
// Update policy (see README, "Decision"): a new version installs in the background and WAITS.
// It only takes over when the user taps "Reload to update", so an installer halfway through a
// quote on a roof never has the app swapped underneath them.

const VERSION = 'sungrid-3ac372f1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/data.js',
  './js/install.js',
  './js/offline.js',
  './js/quote.js',
  './js/router.js',
  './js/sw-register.js',
  './js/util.js',
  './js/views.js',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/shortcut-jobs-96.png',
  './icons/shortcut-quote-96.png',
  './icons/shortcut-stock-96.png',
];

/** Plain-text answer for a file that is neither saved on the device nor reachable on the network. */
function offlineMiss() {
  return new Response('SunGrid Solar is offline and this file is not saved on the device. Reconnect once and reload.', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache, so a new version can never be built from stale files.
  // Deliberately NO skipWaiting() here: the page asks for it (message below) when the user agrees.
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))),
  );
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

  event.respondWith(request.mode === 'navigate' ? answerNavigation(request, url) : answerAsset(request));
});

/** Page loads. The app is a single page, so every address inside it gets the saved index.html. */
async function answerNavigation(request, url) {
  const scope = new URL(self.registration.scope);
  const atRoot = url.pathname === scope.pathname || url.pathname === `${scope.pathname}index.html`;

  // Addresses like /jobs/SG-1042 (no #) would load index.html but break its relative file paths,
  // so send them to the app root. Real app addresses always look like /#/jobs/SG-1042.
  if (!atRoot) return Response.redirect(scope.href, 302);

  try {
    const cache = await caches.open(VERSION);
    const saved = await cache.match('./index.html');
    if (saved) return saved;
    return await fetch(request); // first visit, install not finished yet
  } catch {
    return offlineMiss();
  }
}

/** Scripts, styles, images: saved copy first, then network (and remember it), never an unhandled error. */
async function answerAsset(request) {
  try {
    const cache = await caches.open(VERSION);
    const saved = await cache.match(request, { ignoreSearch: true });
    if (saved) return saved;

    const response = await fetch(request);
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  } catch {
    return offlineMiss();
  }
}

/** How many of the shell files are really saved? Used by the "Offline" page. */
async function cacheStatus() {
  const cache = await caches.open(VERSION);
  const found = await Promise.all(SHELL.map((url) => cache.match(url)));
  return { version: VERSION, expected: SHELL.length, cached: found.filter(Boolean).length };
}

self.addEventListener('message', (event) => {
  const message = event.data || {};

  if (message.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (message.type === 'GET_STATUS' && event.ports && event.ports[0]) {
    const reply = event.ports[0];
    event.waitUntil(
      cacheStatus().then(
        (status) => reply.postMessage(status),
        (err) => reply.postMessage({ error: String(err && err.message ? err.message : err) }),
      ),
    );
  }
});
