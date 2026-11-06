declare const __OFFLINE_FILES__: string[];
declare const __CACHE_NAME__: string;

declare const self: ServiceWorkerGlobalScope;

export {};

self.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(caches.open(__CACHE_NAME__).then((cache) => cache.addAll(__OFFLINE_FILES__)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== __CACHE_NAME__).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

async function respond(request: Request): Promise<Response> {
  const cache = await caches.open(__CACHE_NAME__);
  if (request.mode === "navigate") {
    const shell = await cache.match("/");
    return shell ?? fetch(request);
  }
  return (await cache.match(request)) ?? fetch(request);
}

self.addEventListener("fetch", (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(respond(event.request));
});
