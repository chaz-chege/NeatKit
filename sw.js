/* ============================================================
   NEATKIT — Service Worker
   Strategy:
   - Pages (navigations): network-first, fall back to cache offline,
     so returning visitors always get the newest version of a page.
   - Static same-origin assets (css, js, icons): stale-while-revalidate.
   - Never intercept: the ffmpeg video tools (they rely on COOP/COEP
     headers that a service worker can break), /vendor/ffmpeg/, and /api/.
   - Cross-origin requests are not touched.
   Bump CACHE whenever you want to force every client to drop old caches.
   ============================================================ */

const CACHE = 'neatkit-v2';

// Small app shell only. Pages are cached as they are visited.
const PRECACHE = [
  '/',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
  '/assets/neatkit.css',
  '/assets/neatkit.js',
];

// Pages that need cross-origin isolation (COOP/COEP) for ffmpeg.wasm.
// Compared AFTER normalising, so /tools/video-trim, /tools/video-trim/
// and /tools/video-trim.html are all treated as the same page.
const ISOLATED_PAGES = new Set([
  '/tools/video-compress',
  '/tools/video-trim',
  '/tools/video-to-gif',
]);

function normalisePath(path) {
  return path
    .replace(/\/index\.html$/, '/')
    .replace(/\.html$/, '')
    .replace(/(.)\/+$/, '$1');
}

function shouldBypass(path) {
  return (
    ISOLATED_PAGES.has(normalisePath(path)) ||
    path.startsWith('/vendor/') ||
    path.startsWith('/api/')
  );
}

// ── INSTALL ────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ───────────────────────────────────────────────────
// Delete old caches when a new SW version takes over
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ──────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // CDN, fonts, analytics
  if (shouldBypass(url.pathname)) return;            // let the network and its headers win

  const isPage =
    request.mode === 'navigate' ||
    (request.headers.get('accept') || '').includes('text/html');

  if (isPage) {
    // Network-first. A redirect or error is passed straight through
    // and never cached, so a cached redirect can never break navigation.
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then(cached => cached || caches.match('/'))
        )
    );
    return;
  }

  // Static assets: serve cached copy immediately, refresh it in the background.
  event.respondWith(
    caches.match(request).then(cached => {
      const refresh = fetch(request)
        .then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || refresh;
    })
  );
});
