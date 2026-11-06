// The offline shell. The built files are precached at install; navigations fall back to the
// cached shell when the network is gone. The worker leaves every request under /api alone,
// so the page sees real connectivity and the offline queue decides what happens.

const worker = globalThis as unknown as ServiceWorkerGlobalScope;

const PRECACHE: string[] = "__PRECACHE_URLS__" as unknown as string[];
const CACHE = "snaglight-shell-__PRECACHE_VERSION__";

worker.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => worker.skipWaiting()),
  );
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("snaglight-shell-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => worker.clients.claim()),
  );
});

worker.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== worker.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(async () => (await caches.match("/", { cacheName: CACHE })) ?? Response.error()));
    return;
  }
  event.respondWith(caches.match(event.request, { cacheName: CACHE }).then((hit) => hit ?? fetch(event.request)));
});
