/// <reference lib="webworker" />

const CACHE = 'gevelwerk-shell-v1';
const SHELL = ['/', '/sites', '/styles.css', '/app.js', '/icons.svg'];

const worker = self as unknown as ServiceWorkerGlobalScope;

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
  (event as ExtendableEvent).waitUntil(worker.clients.claim());
});

function isRig(path: string): boolean {
  return path.startsWith('/rig/') || path.startsWith('/api/rig/');
}

/** The shell, survey screen and reading form load without signal; rig addresses are never kept. */
worker.addEventListener('fetch', (event) => {
  const request = (event as FetchEvent).request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== worker.location.origin || isRig(url.pathname)) return;
  (event as FetchEvent).respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const answer = await fetch(request);
        if (answer.ok && !url.pathname.startsWith('/api/')) await cache.put(url.pathname, answer.clone());
        return answer;
      } catch (error) {
        const kept = (await cache.match(url.pathname)) ?? (await cache.match('/'));
        if (kept !== undefined) return kept;
        throw error;
      }
    })(),
  );
});
