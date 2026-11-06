/// <reference lib="webworker" />

/** Caches the built shell so a job opened online opens again with no connection. */
const worker = self as unknown as ServiceWorkerGlobalScope;

const CACHE = 'snaglight-shell-v1';

const SHELL = [
  '/',
  '/assets/app.js',
  '/assets/app.css',
  '/fonts/archivo-latin.woff2',
  '/fonts/ibm-plex-sans-latin.woff2',
  '/fonts/ibm-plex-mono-400.woff2',
  '/fonts/ibm-plex-mono-600.woff2',
];

worker.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      await worker.skipWaiting();
    })(),
  );
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== CACHE) await caches.delete(name);
      }
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(CACHE);
          const shell = await cache.match('/');
          return shell ?? new Response('', { status: 504 });
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached !== undefined) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })(),
  );
});
