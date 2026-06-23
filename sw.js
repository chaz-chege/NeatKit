/* ============================================================
   NEATKIT — Service Worker
   Strategy:
   - Cache-first for all local HTML pages and assets
   - Network-only for video tools (they use COEP/COOP headers
     that conflict with SW interception of cross-origin requests)
   - Network-first for CDN libraries (pdf-lib, ffmpeg, etc.)
   - Offline fallback for everything else
   ============================================================ */

const CACHE = 'neatkit-v1';

// Everything we want cached on install
const PRECACHE = [
  '/',
  '/index.html',
  '/about.html',
  '/contact.html',
  '/privacy.html',
  '/terms.html',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
  '/assets/neatkit.css',
  '/assets/neatkit.js',
  '/tools/image-compress.html',
  '/tools/image-resize.html',
  '/tools/pdf-merge.html',
  '/tools/pdf-compress.html',
  '/tools/images-to-pdf.html',
  '/tools/id-card-to-pdf.html',
  '/tools/photo-to-pdf.html',
  '/tools/word-counter.html',
  '/tools/case-converter.html',
  '/tools/ai-detector.html',
  '/tools/unit-converter.html',
  '/tools/json-formatter.html',
  '/tools/base64.html',
  '/tools/color-converter.html',
  '/tools/qr-generator.html',
  '/tools/qr-scanner.html',
];

// Video tools use Cross-Origin-Embedder-Policy: require-corp (for ffmpeg.wasm).
// A SW that intercepts their requests breaks SharedArrayBuffer.
// These pages are intentionally excluded — they go straight to network.
const NETWORK_ONLY = [
  '/tools/video-compress.html',
  '/tools/video-trim.html',
  '/tools/video-to-gif.html',
];

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
        keys
          .filter(key => key !== CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ──────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Only handle same-origin requests (not CDN, not ads)
  if (url.origin !== self.location.origin) {
    // Network-first for cross-origin (CDN libraries, fonts, etc.)
    // Just let it fall through — no interception
    return;
  }

  const path = url.pathname;

  // Video tools — never intercept, let Cloudflare serve with COEP headers intact
  if (NETWORK_ONLY.some(p => path.startsWith(p))) {
    return;
  }

  // Everything else — cache-first, fall back to network, fall back to offline page
  event.respondWith(
    caches.match(request)
      .then(cached => {
        if (cached) return cached;

        return fetch(request)
          .then(response => {
            // Only cache valid same-origin responses
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            const toCache = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, toCache));
            return response;
          })
          .catch(() => {
            // Offline fallback — return index for HTML navigation requests
            if (request.headers.get('accept')?.includes('text/html')) {
              return caches.match('/index.html');
            }
          });
      })
  );
});