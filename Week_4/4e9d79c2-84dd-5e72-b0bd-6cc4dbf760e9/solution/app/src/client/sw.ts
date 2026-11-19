// The run sheet opens with no signal: pages and the app's own files come from here when the network cannot answer.
const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = "wayticket-run-sheet";

sw.addEventListener("install", () => { void sw.skipWaiting(); });
sw.addEventListener("activate", (event) => { event.waitUntil(sw.clients.claim()); });
sw.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;
  const isPage = request.mode === "navigate" && url.pathname.startsWith("/r/");
  const isAsset = url.pathname.startsWith("/assets/");
  if (!isPage && !isAsset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch (error) {
      const kept = await cache.match(request, { ignoreSearch: isPage });
      if (kept) return kept;
      throw error;
    }
  })());
});
