// Wayticket run-sheet service worker: keeps the page and its queue reachable with no signal.
const CACHE = "wayticket-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/assets/app.css", "/assets/client.js"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(event.request);
        if (fresh.ok) cache.put(event.request, fresh.clone());
        return fresh;
      } catch {
        const cached = await cache.match(event.request, { ignoreSearch: false });
        if (cached) return cached;
        const shell = await cache.match(url.pathname, { ignoreSearch: true });
        if (shell) return shell;
        return new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } });
      }
    })()
  );
});
