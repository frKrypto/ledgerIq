/*
 * Offline support.
 *
 * Two strategies, chosen by what the request is:
 *  - App shell and built assets: cache-first, so the app opens with no signal.
 *  - /api/content: network-first with a cache fallback, so the roadmap is
 *    current when possible and readable when not.
 * Everything else (auth, progress) is left alone — those must hit the network,
 * and the client queues writes itself when they fail.
 */
const VERSION = 'roadmap-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const CONTENT_CACHE = `${VERSION}-content`;
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/api/content') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CONTENT_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  // Other API traffic must be live — never serve a stale session or progress.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && (request.destination === 'script' || request.destination === 'style' || request.destination === 'font')) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          // SPA navigation offline: fall back to the cached shell so routing works.
          request.mode === 'navigate' ? caches.match('/index.html') : Response.error(),
        );
    }),
  );
});
