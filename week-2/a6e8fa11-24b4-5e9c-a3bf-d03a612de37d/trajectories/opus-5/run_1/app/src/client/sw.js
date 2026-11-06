const SHELL_CACHE = 'furrowbook-shell-v1';
const SHELL_PATHS = ['/', '/app.js', '/app.css'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_PATHS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== SHELL_CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

function isShellRequest(request, url) {
  if (request.mode === 'navigate') return true;
  return SHELL_PATHS.includes(url.pathname) || url.pathname.startsWith('/assets/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (!isShellRequest(request, url)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(request.mode === 'navigate' ? '/' : request, copy));
        return response;
      })
      .catch(() =>
        caches.match(request.mode === 'navigate' ? '/' : request).then((cached) => {
          if (cached) return cached;
          return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }),
      ),
  );
});
