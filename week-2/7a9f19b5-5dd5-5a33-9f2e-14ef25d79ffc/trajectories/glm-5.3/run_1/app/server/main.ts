import http from 'node:http'
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { config } from './db.js'
import { init_db, type Pool } from './db.js'
import { Api } from './api.js'
import { page_html } from './pages.js'
import { is_cross_origin } from './http.js'
import { register_routes } from './routes.js'
import { start_background } from './background.js'
import { PocketBaseStore } from './pocketbase.js'
import { create_storage } from './storage.js'
import { create_mailer } from './mail.js'
import { server_today } from './clock.js'

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

interface ServerContext {
  db: Pool
  api: Api
  assets_dir: string
}

function serve_static(res: http.ServerResponse, file: string, cache: boolean): boolean {
  if (!existsSync(file)) return false
  const stat = statSync(file)
  if (!stat.isFile()) return false
  const ext = path.extname(file)
  const mime = MIME[ext]
  if (!mime) return false
  const body = readFileSync(file)
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': body.length,
    'Cache-Control': cache ? 'public, max-age=3600' : 'no-cache',
  })
  res.end(body)
  return true
}

async function main(): Promise<void> {
  const db = await init_db()
  const api = new Api(db, {
    storage: create_storage(),
    mailer: create_mailer(),
    pocketbase: new PocketBaseStore(config().pocketbase_url),
    today: () => server_today(),
  })
  register_routes(api)

  const client_dir = path.resolve('client')
  const build_dir = path.resolve('build/client')
  const assets_dir = existsSync(build_dir) && readdirSync(build_dir).length > 0 ? build_dir : client_dir

  const context: ServerContext = { db, api, assets_dir }

  const server = http.createServer((req, res) => {
    void handle(context, req, res)
  })
  server.on('clientError', (_err, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
  })
  const port = config().app_public_port
  server.listen(port, '0.0.0.0', () => {
    console.log(`Lightfall listening on 0.0.0.0:${port}`)
  })
  start_background(api)
}

async function handle(context: ServerContext, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = decodeURIComponent(url.pathname)

    if (is_cross_origin(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'cross_origin' }))
      return
    }

    // Health answers whenever the HTTP server is running.
    if (pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }

    if (pathname.startsWith('/api/')) {
      await context.api.handle(req, res)
      return
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'not_found' }))
      return
    }

    // Static assets first.
    if (pathname.startsWith('/assets/')) {
      const rel = pathname.slice('/assets/'.length)
      if (rel.includes('..')) {
        res.writeHead(404)
        res.end()
        return
      }
      const root = path.join(context.assets_dir, rel)
      const base = path.resolve(context.assets_dir)
      if (!path.resolve(root).startsWith(base)) {
        res.writeHead(404)
        res.end()
        return
      }
      if (serve_static(res, root, true)) return
      res.writeHead(404)
      res.end()
      return
    }

    // Every page serves the same document; the browser code reads the URL.
    if (!is_page_path(pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not found')
      return
    }
    const title = page_title(pathname)
    const body = page_html(title)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' })
    res.end(body)
  } catch (err) {
    if (!res.writableEnded) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'internal' }))
    }
  }
}

/** The page paths the browser app answers; nothing else is served. */
function is_page_path(pathname: string): boolean {
  if (pathname === '/' || pathname === '/catalogue' || pathname === '/compare' || pathname === '/favourites'
    || pathname === '/cart' || pathname === '/checkout' || pathname === '/signin' || pathname === '/signup'
    || pathname === '/account' || pathname === '/projects' || pathname === '/admin') {
    return true
  }
  if (pathname.startsWith('/products/') || pathname.startsWith('/orders/') || pathname.startsWith('/projects/')) {
    return true
  }
  if (pathname === '/newsletter/confirm' || pathname.startsWith('/newsletter/confirm')) {
    return true
  }
  return false
}

function page_title(pathname: string): string {
  if (pathname === '/') return 'Lightfall'
  if (pathname.startsWith('/products/')) return 'Lightfall — Fitting'
  if (pathname.startsWith('/projects/')) return 'Lightfall — Project'
  const known: Record<string, string> = {
    '/catalogue': 'Lightfall — Catalogue',
    '/compare': 'Lightfall — Comparison',
    '/favourites': 'Lightfall — Favourites',
    '/cart': 'Lightfall — Cart',
    '/checkout': 'Lightfall — Checkout',
    '/signin': 'Lightfall — Sign in',
    '/signup': 'Sign up — Lightfall',
    '/projects': 'Lightfall — Projects',
    '/admin': 'Lightfall — Admin',
    '/account': 'Lightfall — Account',
    '/orders': 'Lightfall — Orders',
  }
  return known[pathname] ?? 'Lightfall'
}

void main()
