// The offline shell: after one online visit the app serves itself from the
// device, so the working screens open with no network (DP-18, DP-88).
const CACHE = "lowlamp-shell-v1";
const SHELL = ["/", "/app.js", "/app.css", "/fonts/sora-400.woff2", "/fonts/sora-500.woff2", "/fonts/sora-600.woff2", "/fonts/sora-700.woff2"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API calls always go to the network; the device copy handles offline.
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch {
        // Any route falls back to the shell the app re-renders from its own
        // router.
        const shell = await cache.match("/");
        if (shell) return shell;
        return new Response("Offline", { status: 503 });
      }
    })(),
  );
});
