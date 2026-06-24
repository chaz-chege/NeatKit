/**
 * Neatkit — Cloudflare Worker
 * Serves static assets and injects security headers.
 * Replaces _headers (which only works on Cloudflare Pages, not Workers).
 */

// Pages/paths that need SharedArrayBuffer isolation for ffmpeg.wasm
const VIDEO_TOOLS = [
  '/tools/video-compress.html',
  '/tools/video-compress',
  '/tools/video-trim.html',
  '/tools/video-trim',
  '/tools/video-to-gif.html',
  '/tools/video-to-gif',
];

// Camera-enabled tools
const CAMERA_TOOLS = [
  '/tools/qr-scanner.html',
  '/tools/qr-scanner',
  '/tools/photo-to-pdf.html',
  '/tools/photo-to-pdf',
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ── ffmpeg worker proxy ──────────────────────────────────
    // Fetches the ffmpeg core worker from unpkg and re-serves it from this
    // origin so COEP's require-corp check passes (cross-origin fetch blocked).
    

    // Serve the static asset
    const response = await env.ASSETS.fetch(request);

    // Clone so we can modify headers
    const newHeaders = new Headers(response.headers);

    // ── Global security headers ──────────────────────────────
    newHeaders.set('X-Frame-Options', 'SAMEORIGIN');
    newHeaders.set('X-Content-Type-Options', 'nosniff');
    newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    newHeaders.set('X-XSS-Protection', '1; mode=block');

    // ── vendor/ffmpeg — must be cross-origin so COEP pages can load them ──
    newHeaders.set('X-Debug-Path', path);
    if (path.startsWith('/vendor/ffmpeg/')) {
      newHeaders.delete('Cross-Origin-Resource-Policy');
      newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
      newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
      newHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
      newHeaders.set('X-Debug-Worker', 'vendor-matched');
}

    // ── Video tools — need COOP + COEP for SharedArrayBuffer ──
    if (VIDEO_TOOLS.includes(path)) {
      newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
      newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
      newHeaders.set('Permissions-Policy', 'camera=()');
    }

    // ── Camera tools ─────────────────────────────────────────
    if (CAMERA_TOOLS.includes(path)) {
      newHeaders.set('Permissions-Policy', 'camera=(self)');
    }

    // ── Cache rules ──────────────────────────────────────────
    if (path.startsWith('/assets/')) {
      newHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (path === '/sw.js') {
      newHeaders.set('Cache-Control', 'no-cache');
    } else if (path.endsWith('.html') || path === '/') {
      newHeaders.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    } else if (path.endsWith('.png') || path.endsWith('.jpg') ||
               path.endsWith('.webp') || path.endsWith('.svg')) {
      newHeaders.set('Cache-Control', 'public, max-age=604800');
    } else if (path === '/sitemap.xml') {
      newHeaders.set('Cache-Control', 'public, max-age=86400');
    } else if (path === '/robots.txt') {
      newHeaders.set('Cache-Control', 'public, max-age=86400');
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};