/** Keeps the app shell on the device: network first, the last good copy when there is no signal. */

const sw = self as unknown as {
  addEventListener(type: string, listener: (event: never) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
};

const CACHE = "lowlamp-shell-v1";

interface ExtendableEventLike {
  waitUntil(work: Promise<unknown>): void;
}
interface FetchEventLike extends ExtendableEventLike {
  request: Request;
  respondWith(response: Promise<Response>): void;
}

sw.addEventListener("install", ((event: ExtendableEventLike) => {
  event.waitUntil(sw.skipWaiting());
}) as (event: never) => void);

sw.addEventListener("activate", ((event: ExtendableEventLike) => {
  event.waitUntil(sw.clients.claim());
}) as (event: never) => void);

sw.addEventListener("fetch", ((event: FetchEventLike) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  const key = request.mode === "navigate" ? "/" : request.url;
  event.respondWith(
    fetch(request)
      .then(async (response) => {
        if (response.ok) (await caches.open(CACHE)).put(key, response.clone());
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(key);
        if (cached) return cached;
        return Response.error();
      }),
  );
}) as (event: never) => void);
