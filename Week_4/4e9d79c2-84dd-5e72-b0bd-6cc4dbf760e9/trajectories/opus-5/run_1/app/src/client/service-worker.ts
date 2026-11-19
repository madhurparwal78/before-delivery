/// <reference lib="webworker" />
const worker = self as unknown as ServiceWorkerGlobalScope;

const CACHE = 'wayticket-run-sheet-v1';

worker.addEventListener('install', (event) => {
  (event as ExtendableEvent).waitUntil(worker.skipWaiting());
});

worker.addEventListener('activate', (event) => {
  (event as ExtendableEvent).waitUntil(worker.clients.claim());
});

/** The run sheet and its files stay readable with no signal, so a reload keeps the page. */
worker.addEventListener('fetch', (event) => {
  const fetchEvent = event as FetchEvent;
  const request = fetchEvent.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const keepable =
    url.pathname.startsWith('/r/') ||
    url.pathname === '/app.js' ||
    url.pathname === '/app.css' ||
    url.pathname.startsWith('/fonts/');
  if (!keepable) return;
  fetchEvent.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const answer = await fetch(request);
        if (answer.ok) await cache.put(request, answer.clone());
        return answer;
      } catch {
        const held = await cache.match(request, { ignoreSearch: url.pathname.startsWith('/r/') });
        if (held) return held;
        throw new Error('nothing kept for that address');
      }
    })(),
  );
});
