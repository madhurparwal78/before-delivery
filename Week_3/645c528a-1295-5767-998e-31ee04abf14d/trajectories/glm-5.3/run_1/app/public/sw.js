// Long Rail Headstring service worker: keeps the shell, fonts, tutorial and
// practice available with no network. Runtime caching is best-effort only.
const VERSION = 'headstring-v1';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icon.svg',
  '/assets/fonts/big-shoulders-display.woff2',
  '/assets/fonts/ibm-plex-sans.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await Promise.allSettled(SHELL.map((path) => cache.add(new Request(path, { cache: 'reload' }))));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) {
        // Refresh quietly in the background where the network allows.
        void fetch(request).then((fresh) => {
          if (fresh && fresh.ok) void cache.put(request, fresh.clone());
        }).catch(() => undefined);
        return cached;
      }
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok && fresh.type === 'basic') {
          void cache.put(request, fresh.clone());
        }
        return fresh;
      } catch {
        const shell = await cache.match('/index.html');
        if (shell) return shell;
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })()
  );
});
