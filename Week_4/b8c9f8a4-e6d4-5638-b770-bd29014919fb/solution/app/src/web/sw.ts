// The inspector page's service worker. It handles the page shell and the assets only, and never
// touches /api/*, so an ended link still ends while there is a connection.

/// <reference lib="webworker" />

const worker = self as unknown as ServiceWorkerGlobalScope;
const CACHE = 'open-bonnet-shell-v1';
const SHELL = '/__shell';
const ASSETS = ['/app.js', '/app.css', '/favicon.svg'];

worker.addEventListener('install', (event) => {
  const work = (event as ExtendableEvent);
  work.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => worker.skipWaiting()),
  );
});

worker.addEventListener('activate', (event) => {
  (event as ExtendableEvent).waitUntil(worker.clients.claim());
});

worker.addEventListener('fetch', (event) => {
  const request = (event as FetchEvent).request;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    (event as FetchEvent).respondWith(
      fetch(request)
        .then(async (reply) => {
          const cache = await caches.open(CACHE);
          await cache.put(SHELL, reply.clone());
          return reply;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE);
          const held = await cache.match(SHELL);
          return held ?? Response.error();
        }),
    );
    return;
  }

  if (!ASSETS.includes(url.pathname) && !url.pathname.startsWith('/fonts/')) return;
  (event as FetchEvent).respondWith(
    caches.match(request).then((held) => held ?? fetch(request).then(async (reply) => {
      const cache = await caches.open(CACHE);
      await cache.put(request, reply.clone());
      return reply;
    })),
  );
});

export {};
