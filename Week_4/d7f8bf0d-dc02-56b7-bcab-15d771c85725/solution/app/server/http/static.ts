import { readFile } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../web/', import.meta.url))

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
}

// Serves only the built frontend: the page at `/` and the files under /assets and /fonts.
export async function serveStatic(path: string, res: ServerResponse): Promise<boolean> {
  const relative = path === '/' ? 'index.html' : normalize(path).replace(/^[/\\]+/, '')
  if (relative.startsWith('..') || !(relative === 'index.html' || relative.startsWith('assets/') || relative.startsWith('fonts/'))) return false
  try {
    const bytes = await readFile(join(ROOT, relative))
    const immutable = relative !== 'index.html'
    res.writeHead(200, {
      'Content-Type': TYPES[extname(relative)] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(bytes)
    return true
  } catch {
    return false
  }
}
