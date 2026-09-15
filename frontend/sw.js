/* ============================================================================
   SiteTrack service worker — offline shell + asset cache.
   API traffic (./api, Apps Script URLs) is NEVER cached: attendance writes must
   always reach the server (or the app's own IndexedDB/localStorage queue).
   ========================================================================== */
const VERSION = 'sitetrack-v1';
const SHELL = [
  './',
  './index.html',
  './login.html',
  './signup.html',
  './status.html',
  './app.html',
  './mobile.html',
  './owner.html',
  './manifest.webmanifest',
  './config.js',
  './assets/css/app.css',
  './assets/js/i18n.js',
  './assets/js/api.js',
  './assets/js/ui.js',
  './assets/js/map.js',
  './assets/js/admin.js',
  './assets/js/mobile.js',
  './assets/js/owner.js',
  './assets/icons/logo.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './favicon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isApi(url) {
  return /\/api(\?|$)/.test(url.pathname) ||
    /script\.google(usercontent)?\.com/.test(url.hostname) ||
    url.searchParams.has('action');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // never touch POSTs (attendance, login…)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // CDN tiles, QR images stay direct
  if (isApi(url)) return;                           // API always live

  // Navigations: network first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./mobile.html')))
    );
    return;
  }

  // Static assets: cache first, refresh in background.
  event.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || refresh;
    })
  );
});
