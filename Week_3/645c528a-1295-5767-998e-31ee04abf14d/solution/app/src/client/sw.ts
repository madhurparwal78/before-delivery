/// <reference lib="webworker" />
declare const SHELL_VERSION: string;
declare const SHELL_FILES: string[];

declare const worker: ServiceWorkerGlobalScope;
const CACHE = `headstring-${SHELL_VERSION}`;

worker.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL_FILES)).then(() => worker.skipWaiting()));
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => worker.clients.claim()),
  );
});

worker.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== worker.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => (await caches.match('/shell')) as Response));
    return;
  }
  event.respondWith(caches.match(url.pathname).then((cached) => cached ?? fetch(event.request)));
});
