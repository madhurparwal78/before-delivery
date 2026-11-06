// Service worker: keeps the app shell and its assets on the device so the notebook opens and
// edits with the network off. API, dossier and preview requests always go to the network.

interface ExtendableEvent extends Event {
  waitUntil(work: Promise<unknown>): void;
}

interface FetchEvent extends ExtendableEvent {
  request: Request;
  respondWith(response: Promise<Response>): void;
}

interface WorkerScope {
  location: Location;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
}

const worker = self as unknown as WorkerScope;

const CACHE = "cairn-shell-v1";
const SHELL = [
  "/", "/app.js", "/app.css",
  "/fonts/fraunces-latin-opsz-normal.woff2", "/fonts/ibm-plex-sans-latin-400-normal.woff2",
  "/fonts/ibm-plex-sans-latin-500-normal.woff2", "/fonts/ibm-plex-sans-latin-600-normal.woff2",
  "/fonts/ibm-plex-mono-latin-400-normal.woff2", "/fonts/ibm-plex-mono-latin-500-normal.woff2",
];
const SHELL_ROUTES = [/^\/$/, /^\/ops$/, /^\/devices\/approve\/[^/]+$/, /^\/invites\/[^/]+$/];

worker.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => worker.skipWaiting()));
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
    .then(() => worker.clients.claim()));
});

worker.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== worker.location.origin) return;
  const shellRoute = SHELL_ROUTES.some((r) => r.test(url.pathname));
  if (!shellRoute && !SHELL.includes(url.pathname)) return;
  const cacheKey = shellRoute ? "/" : url.pathname;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      void caches.open(CACHE).then((cache) => cache.put(cacheKey, copy));
    }
    return response;
  }).catch(async () => (await caches.match(cacheKey)) ?? Response.error()));
});
