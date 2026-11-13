/**
 * The app shell service worker. It serves the shell, its assets and the last
 * loaded closet, lists and profile with no connection, so a previously opened
 * workspace still loads at the trailhead.
 */

/** The service worker scope, with the event types the shell uses. */
interface ShellEvent {
  readonly request: Request;
  waitUntil(work: Promise<unknown>): void;
  respondWith(response: Promise<Response>): void;
}

interface CacheHost {
  addAll(urls: readonly string[]): Promise<void>;
  put(request: Request | string, response: Response): Promise<void>;
  match(request: Request | string): Promise<Response | undefined>;
  keys(): Promise<readonly Request[]>;
}

declare const caches: { open(name: string): Promise<CacheHost>; keys(): Promise<readonly string[]>; delete(name: string): Promise<boolean> };
declare const self: {
  location: { origin: string };
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(name: string, handler: (event: ShellEvent) => void): void;
};

const SHELL_CACHE = 'skinout-shell-v1';
const SHELL_ASSETS = ['/', '/assets/app.js', '/assets/app.css', '/assets/fonts/space-grotesk-latin-500-normal.woff2', '/assets/fonts/space-grotesk-latin-700-normal.woff2', '/assets/fonts/ibm-plex-sans-latin-400-normal.woff2', '/assets/fonts/ibm-plex-sans-latin-600-normal.woff2', '/assets/fonts/ibm-plex-mono-latin-400-normal.woff2'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_ASSETS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      for (const name of names) {
        if (name !== SHELL_CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API reads are cached last; writes pass through to the network.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const response = await fetch(request);
          if (response.ok && !url.pathname.startsWith('/api/photos')) {
            await cache.put(request, response.clone());
          }
          return response;
        } catch {
          const cached = await cache.match(request);
          if (cached !== undefined) return cached;
          return new Response(JSON.stringify({ error: { code: 'network', message: 'offline' } }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        }
      })(),
    );
    return;
  }

  // Pages and assets: cache first, then network. A signed-in page is cached
  // as the shell so a previously opened workspace reloads with no connection.
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request);
      if (cached !== undefined) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) {
          const shell = response.headers.get('content-type')?.includes('text/html') === true ? await cache.match('/') : undefined;
          if (shell !== undefined) {
            await cache.put(request, shell.clone());
          } else {
            await cache.put(request, response.clone());
          }
        }
        return response;
      } catch {
        const shell = await cache.match('/');
        if (shell !== undefined) return shell;
        return new Response('Offline', { status: 503 });
      }
    })(),
  );
});

export {};
