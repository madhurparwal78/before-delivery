/// <reference lib="webworker" />

function serviceWorkerScope(): ServiceWorkerGlobalScope {
  if (!(self instanceof ServiceWorkerGlobalScope)) throw new Error('Not a service worker scope');
  return self;
}

const scope = serviceWorkerScope();

const CACHE = 'lanternfish-shell-v1';
const SHELL = [
  '/',
  '/app.js',
  '/app.css',
  '/fonts/fraunces-600.woff2',
  '/fonts/fraunces-600-ext.woff2',
  '/fonts/atkinson-400.woff2',
  '/fonts/atkinson-400-ext.woff2',
];

scope.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      await scope.skipWaiting();
    })(),
  );
});

scope.addEventListener('activate', (event) => {
  event.waitUntil(scope.clients.claim());
});

async function networkFirstShell(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (request.method === 'GET' && response.ok) await cache.put('/', response.clone());
    return response;
  } catch {
    const cached = await cache.match('/');
    if (cached !== undefined) return cached;
    return new Response('', { status: 503 });
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached !== undefined) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

scope.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== scope.location.origin || request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }
  if (SHELL.includes(url.pathname)) event.respondWith(cacheFirst(request));
});
