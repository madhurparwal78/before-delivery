/// <reference lib="webworker" />
const worker = self as unknown as ServiceWorkerGlobalScope;

const CACHE = 'headstring-shell-v1';
const SHELL = [
  '/',
  '/app.js',
  '/styles.css',
  '/manifest.webmanifest',
  '/fonts/big-shoulders-display.woff2',
  '/fonts/ibm-plex-sans.woff2',
];

worker.addEventListener('install', (event) => {
  const install = event as ExtendableEvent;
  install.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.addAll(SHELL);
      await worker.skipWaiting();
    }),
  );
});

worker.addEventListener('activate', (event) => {
  const activate = event as ExtendableEvent;
  activate.waitUntil(worker.clients.claim());
});

worker.addEventListener('fetch', (event) => {
  const request = (event as FetchEvent).request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== worker.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  (event as FetchEvent).respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        const shell = await cache.match('/');
        if (shell) return shell;
        return new Response('', { status: 504 });
      }
    })(),
  );
});
