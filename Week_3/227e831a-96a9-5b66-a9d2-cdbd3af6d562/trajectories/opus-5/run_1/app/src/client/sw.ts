interface InstallEvent extends Event {
  waitUntil: (work: Promise<unknown>) => void;
}

interface FetchEvent extends Event {
  request: Request;
  respondWith: (response: Response | Promise<Response>) => void;
}

const worker = self as unknown as {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  skipWaiting: () => Promise<void>;
  clients: { claim: () => Promise<void> };
};

const SHELL_CACHE = 'skinout-shell-v1';
const DATA_CACHE = 'skinout-data-v1';
const SHELL_KEY = '/trips';
const ASSETS = [
  '/app.js',
  '/app.css',
  '/fonts/space-grotesk-700.woff2',
  '/fonts/space-grotesk-500.woff2',
  '/fonts/ibm-plex-sans-400.woff2',
  '/fonts/ibm-plex-sans-600.woff2',
  '/fonts/ibm-plex-mono-400.woff2',
  '/fonts/ibm-plex-mono-600.woff2',
];

worker.addEventListener('install', (event) => {
  (event as InstallEvent).waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(ASSETS);
      await worker.skipWaiting();
    })(),
  );
});

worker.addEventListener('activate', (event) => {
  (event as InstallEvent).waitUntil(worker.clients.claim());
});

async function networkFirst(request: Request, cacheName: string, key?: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(key ?? request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(key ?? request);
    if (cached !== undefined) return cached;
    throw error;
  }
}

/** The shell, the last loaded data and the assets keep the app usable offline. */
worker.addEventListener('fetch', (event) => {
  const fetchEvent = event as FetchEvent;
  const request = fetchEvent.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    fetchEvent.respondWith(networkFirst(request, SHELL_CACHE, SHELL_KEY));
    return;
  }
  if (ASSETS.includes(url.pathname)) {
    fetchEvent.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }
  if (
    url.pathname === '/api/profile' ||
    url.pathname === '/api/closet' ||
    url.pathname === '/api/lists' ||
    /^\/api\/lists\/[^/]+$/.test(url.pathname)
  ) {
    fetchEvent.respondWith(networkFirst(request, DATA_CACHE));
  }
});
