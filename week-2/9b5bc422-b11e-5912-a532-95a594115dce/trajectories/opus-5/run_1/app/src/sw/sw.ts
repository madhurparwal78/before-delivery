/// <reference lib="webworker" />
declare const PRECACHE_FILES: string[];
declare const CACHE_NAME: string;

const worker = self as unknown as ServiceWorkerGlobalScope;

const SHELL = '/index.html';

worker.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll([...new Set([...PRECACHE_FILES, SHELL])]);
      await worker.skipWaiting();
    })(),
  );
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
      await worker.clients.claim();
    })(),
  );
});

async function shell(): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(SHELL);
  if (cached) return cached;
  return fetch(SHELL);
}

async function asset(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
  return response;
}

worker.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(shell());
    return;
  }
  event.respondWith(asset(request));
});
