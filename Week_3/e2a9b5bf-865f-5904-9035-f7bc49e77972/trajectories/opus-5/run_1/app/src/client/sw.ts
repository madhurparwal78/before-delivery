/// <reference lib="webworker" />

/**
 * The app shell is kept so working screens open with no network. Everything the
 * observer has logged is held in IndexedDB by the app itself.
 */
const SHELL_CACHE = 'lowlamp-shell-v1';
const SHELL_FILES = [
  '/',
  '/app.js',
  '/app.css',
  '/fonts/sora-400.woff2',
  '/fonts/sora-600.woff2',
];

const worker = self as unknown as ServiceWorkerGlobalScope;

worker.addEventListener('install', (event) => {
  const install = event as ExtendableEvent;
  install.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => worker.skipWaiting()),
  );
});

worker.addEventListener('activate', (event) => {
  const activate = event as ExtendableEvent;
  activate.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== SHELL_CACHE).map((name) => caches.delete(name))),
      )
      .then(() => worker.clients.claim()),
  );
});

const APP_ROUTES = [
  /^\/$/,
  /^\/signup$/,
  /^\/signin$/,
  /^\/tonight$/,
  /^\/kit$/,
  /^\/programs$/,
  /^\/programs\/[^/]+$/,
  /^\/sessions\/[^/]+$/,
  /^\/objects\/[^/]+$/,
  /^\/packets\/[^/]+$/,
];

worker.addEventListener('fetch', (event) => {
  const request = (event as FetchEvent).request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;
  // Authenticated reads are never cached.
  if (url.pathname.startsWith('/api/')) return;

  const isShellAsset = SHELL_FILES.includes(url.pathname) && url.pathname !== '/';
  const isAppRoute = APP_ROUTES.some((pattern) => pattern.test(url.pathname));
  if (!isShellAsset && !isAppRoute) return;

  (event as FetchEvent).respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const key = isShellAsset ? url.pathname : '/';
      try {
        const fresh = await fetch(request);
        if (fresh.ok) await cache.put(key, fresh.clone());
        return fresh;
      } catch {
        const cached = await cache.match(key);
        if (cached) return cached;
        throw new Error('offline and not cached');
      }
    })(),
  );
});
