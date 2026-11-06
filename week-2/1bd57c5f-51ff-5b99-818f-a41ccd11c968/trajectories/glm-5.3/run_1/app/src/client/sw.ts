/** The service worker: it keeps the app shell and the last fetched GETs on the
 *  device, so a job opened online opens again after a reload with no
 *  connection. Mutating requests are never handled here; offline writes go
 *  through the queue instead. */

type CacheEntry = { put(request: RequestInfo, response: Response): Promise<void>; match(request: RequestInfo): Promise<Response | undefined> };
type CacheStorageLike = { open(name: string): Promise<CacheEntry> };

type FetchEventLike = {
  request: Request;
  respondWith(promise: Promise<Response>): void;
};

type WorkerScope = {
  addEventListener(type: "fetch", listener: (event: FetchEventLike) => void): void;
  skipWaiting(): Promise<void>;
  caches: CacheStorageLike;
  location: { origin: string };
};

const scope = self as unknown as WorkerScope;
const CACHE = "snaglight-v1";

scope.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== scope.location.origin) return;
  if (url.pathname.endsWith("/events")) return;

  event.respondWith((async (): Promise<Response> => {
    const cache = await scope.caches.open(CACHE);
    try {
      const fresh = await fetch(request);
      if (fresh.status === 200) {
        void cache.put(request, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await cache.match(request);
      if (cached !== undefined) return cached;
      if (request.mode === "navigate") {
        const shell = await cache.match("/index.html");
        if (shell !== undefined) return shell;
      }
      return new Response("Offline", { status: 503, statusText: "Offline" });
    }
  })());
});

export {};
