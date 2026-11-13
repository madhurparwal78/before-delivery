// The service worker: after one online visit the shell, survey screen and reading form
// load with no network; it never stores anything from a rig address.

const CACHE = 'gevelwerk-shell-v1';
const SHELL = [
  '/',
  '/styles.css',
  '/main.js',
  '/app.js',
  '/ui.js',
  '/hero.js',
  '/walls.js',
  '/survey.js',
  '/workspace.js',
  '/shelf.js',
  '/hire.js',
  '/sheet.js',
  '/rig.js',
  '/offline.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  // never store anything from a rig address
  if (url.pathname.startsWith('/rig/')) return;
  if (url.pathname.startsWith('/api/rig/')) return;
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok && !url.pathname.startsWith('/api/')) {
        cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const shell = await cache.match('/');
      if (shell) return shell;
      return new Response('offline', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }
  })());
});
