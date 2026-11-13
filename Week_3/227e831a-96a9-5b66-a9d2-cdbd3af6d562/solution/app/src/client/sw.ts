/// <reference lib="webworker" />
const scope = self as unknown as ServiceWorkerGlobalScope

const SHELL = 'skinout-shell-v1'
const ASSETS = 'skinout-assets-v1'
const SHELL_KEY = '/__shell'
const APP_PAGES = /^\/(sign-in|closet|trips|imports|settings|lists\/[^/]+)$/

/** The built scripts, styles and fonts a page needs, found from the shell and the stylesheets it links. */
async function precache(): Promise<void> {
  const shell = await fetch('/sign-in', { cache: 'reload' })
  const html = await shell.clone().text()
  await (await caches.open(SHELL)).put(SHELL_KEY, shell)
  const assets = caches.open(ASSETS)
  const urls = new Set([...html.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)].map((match) => match[1] ?? ''))
  for (const url of [...urls]) {
    const response = await fetch(url)
    if (!response.ok) continue
    await (await assets).put(url, response.clone())
    if (url.endsWith('.css')) {
      for (const match of (await response.text()).matchAll(/url\((\/assets\/[^)]+)\)/g)) urls.add(match[1] ?? '')
    }
  }
  for (const url of urls) {
    if (await (await assets).match(url)) continue
    const response = await fetch(url)
    if (response.ok) await (await assets).put(url, response)
  }
}

scope.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => scope.skipWaiting()))
})

scope.addEventListener('activate', (event) => {
  event.waitUntil(scope.clients.claim())
})

async function page(request: Request): Promise<Response> {
  try {
    const response = await fetch(request)
    if (response.ok && !response.redirected) await (await caches.open(SHELL)).put(SHELL_KEY, response.clone())
    return response
  } catch {
    const cached = await (await caches.open(SHELL)).match(SHELL_KEY)
    return cached ?? Response.error()
  }
}

async function asset(request: Request): Promise<Response> {
  const cache = await caches.open(ASSETS)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

scope.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== scope.location.origin) return
  if (request.mode === 'navigate' && APP_PAGES.test(url.pathname)) event.respondWith(page(request))
  else if (url.pathname.startsWith('/assets/')) event.respondWith(asset(request))
})
