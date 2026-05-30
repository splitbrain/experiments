// Service worker: precaches the app shell for offline use and installability.
//
// CACHE_VERSION is stamped at deploy time (the GitHub Actions workflow replaces
// the __BUILD_ID__ token with the commit SHA), so every deploy produces a new
// cache name and reliably invalidates the old shell. In local development the
// literal token is used, which is fine.
//
// Updates are surfaced to the page rather than applied silently: a newly
// installed worker waits until the page posts SKIP_WAITING (from the user
// tapping the "update" prompt), then activates and claims clients, which the
// page observes via `controllerchange` and reloads.

const CACHE_VERSION = '__BUILD_ID__';
const CACHE_NAME = `voicenotes-${CACHE_VERSION}`;

// Relative URLs keep the scope under /voicenotes/.
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/router.js',
  './js/storage.js',
  './js/recorder.js',
  './js/audio.js',
  './js/transcriber.js',
  './js/transcription-worker.js',
  './js/ui.js',
  './js/views/listView.js',
  './js/views/noteView.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // Precache with cache:'reload' so the freshly deployed files are fetched from
  // the network, never the browser's HTTP cache. Do NOT skipWaiting here — the
  // new worker waits until the user accepts the update.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL.map((url) =>
          fetch(new Request(url, { cache: 'reload' })).then((res) => {
            if (!res.ok) throw new Error(`precache failed: ${url}`);
            return cache.put(url, res);
          })
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.startsWith('voicenotes-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only handle same-origin requests. The Whisper model is loaded cross-origin
  // from a CDN / the HF hub and managed by transformers.js's own cache.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
