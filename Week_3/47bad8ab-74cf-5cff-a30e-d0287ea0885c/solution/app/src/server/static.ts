import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.ts'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
}

const PAGES = [/^\/$/, /^\/puzzles$/, /^\/upload$/, /^\/history$/, /^\/build$/, /^\/games\/[^/]+$/, /^\/g\/[^/]+$/]
const clientRoot = fileURLToPath(new URL('./client/', import.meta.url))

interface Asset {
  bytes: Buffer
  type: string
}

function loadAssets(directory: string): Map<string, Asset> {
  const assets = new Map<string, Asset>()
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) {
      for (const [key, asset] of loadAssets(path)) assets.set(key, asset)
    } else assets.set(`/${relative(clientRoot, path).split(sep).join('/')}`, { bytes: readFileSync(path), type: TYPES[extname(name)] ?? 'application/octet-stream' })
  }
  return assets
}

const assets = loadAssets(clientRoot)
const index = assets.get('/index.html')
const page = index && Buffer.from(index.bytes.toString('utf8').replace('__LINK_BASE__', config.publicUrl ?? ''))

interface StaticReply {
  status: number
  bytes: Buffer
  type: string
  cache: string
}

/** Only files built into the client are served; every other path gets the page shell, with 404 unless it is a page route. */
export function serveStatic(pathname: string): StaticReply {
  const asset = assets.get(pathname)
  if (asset && pathname !== '/index.html') return { status: 200, bytes: asset.bytes, type: asset.type, cache: pathname.startsWith('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache' }
  return { status: PAGES.some((route) => route.test(pathname)) ? 200 : 404, bytes: page ?? Buffer.alloc(0), type: TYPES['.html'], cache: 'no-cache' }
}
