/* Offline support for the hosted build.
 *
 * Deliberately simple: a versioned cache, network-first for navigations (so a
 * deployed update is picked up), cache-first for hashed build assets (which are
 * immutable by filename). The single-file build never registers this — it is
 * already self-contained.
 */
const VERSION = 'nce-study-v1';
const OFFLINE_URLS = ['', 'index.html', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      // Resolve against the SW scope so this works under a GitHub Pages subpath.
      const urls = OFFLINE_URLS.map((u) => new URL(u, self.registration.scope).toString());
      await cache.addAll(urls).catch(() => {
        /* a missing optional asset must not block installation */
      });
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: try the network so updates land, fall back to cache offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(VERSION);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(request);
          return (
            cached ??
            (await caches.match(new URL('index.html', self.registration.scope).toString())) ??
            new Response('Offline and no cached copy available.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' },
            })
          );
        }
      })(),
    );
    return;
  }

  // Build assets are content-hashed, so cache-first is safe and fast.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(VERSION);
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
