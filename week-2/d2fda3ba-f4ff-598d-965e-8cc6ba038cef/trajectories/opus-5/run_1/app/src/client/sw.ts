/// <reference lib="webworker" />

/**
 * Keeps the app shell on the device so the notebook opens and edits with the network off,
 * including after a reload. Published dossiers and the API always go to the network.
 */
const CACHE = 'cairn-shell-v1';
const SHELL = ['/', '/assets/app.js', '/assets/app.css'];

const worker = self as unknown as ServiceWorkerGlobalScope;

worker.addEventListener('install', (event) => {
  const install = event as ExtendableEvent;
  install.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => worker.skipWaiting()),
  );
});

worker.addEventListener('activate', (event) => {
  const activate = event as ExtendableEvent;
  activate.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => worker.clients.claim()),
  );
});

function isAppRequest(url: URL): boolean {
  if (url.origin !== worker.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname.startsWith('/d/') || url.pathname.startsWith('/p/')) return false;
  return true;
}

worker.addEventListener('fetch', (event) => {
  const request = (event as FetchEvent).request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!isAppRequest(url)) return;

  const key = request.mode === 'navigate' ? '/' : request.url;
  (event as FetchEvent).respondWith(
    fetch(request)
      .then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(key, response.clone());
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(key);
        if (cached) return cached;
        const shell = await caches.match('/');
        if (shell) return shell;
        return new Response('offline', { status: 503, headers: { 'content-type': 'text/plain' } });
      }),
  );
});
