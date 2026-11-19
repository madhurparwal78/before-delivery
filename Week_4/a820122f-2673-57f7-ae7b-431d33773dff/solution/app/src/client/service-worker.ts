/// <reference lib="webworker" />
const worker = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = 'sixbell-shell-v1';
const SHELL_ASSETS = [
  '/log',
  '/static/app.js',
  '/static/app.css',
  '/static/fonts/spectral-400.woff2',
  '/static/fonts/spectral-400-italic.woff2',
  '/static/fonts/spectral-600.woff2',
  '/static/fonts/spectral-600-italic.woff2',
  '/static/fonts/plex-400.woff2',
  '/static/fonts/plex-500.woff2',
  '/static/fonts/plex-600.woff2',
];

worker.addEventListener('install', (event) => {
  const install = event as ExtendableEvent;
  install.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(SHELL_ASSETS);
      await worker.skipWaiting();
    })(),
  );
});

worker.addEventListener('activate', (event) => {
  const activate = event as ExtendableEvent;
  activate.waitUntil(worker.clients.claim());
});

async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached !== undefined) return cached;
    const shell = await cache.match('/log');
    if (shell !== undefined) return shell;
    throw error;
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached !== undefined) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

worker.addEventListener('fetch', (event) => {
  const fetchEvent = event as FetchEvent;
  const request = fetchEvent.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/static/')) {
    fetchEvent.respondWith(cacheFirst(request));
    return;
  }
  fetchEvent.respondWith(networkFirst(request));
});
