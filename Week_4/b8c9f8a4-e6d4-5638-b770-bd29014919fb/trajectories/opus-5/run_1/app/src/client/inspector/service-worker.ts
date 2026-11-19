/// <reference lib="webworker" />

/**
 * Handles the page shell and assets only, and never touches /api/*. While there is a
 * connection the shell comes from the server, so an ended link still ends.
 */
export {};

declare const self: ServiceWorkerGlobalScope;

const CACHE = 'open-bonnet-shell-v1';
const ASSETS = ['/link.js', '/open-bonnet.css', '/fonts/outfit-latin.woff2', '/fonts/outfit-latin-ext.woff2'];

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

const shellOrAsset = (url: URL): boolean =>
  url.pathname.startsWith('/l/') || ASSETS.includes(url.pathname);

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (!shellOrAsset(url)) return;

  event.respondWith(
    (async (): Promise<Response> => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(event.request);
        if (fresh.ok) await cache.put(event.request, fresh.clone());
        return fresh;
      } catch {
        const stored = await cache.match(event.request);
        if (stored !== undefined) return stored;
        throw new Error('That asset is not on this device');
      }
    })(),
  );
});
