import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAccess } from './access.ts'
import { currentUser } from './auth.ts'
import type { UserJson } from '../shared/domain.ts'
import { config } from './config.ts'
import { ApiError } from './errors.ts'
import { resolveShare } from './shares.ts'
import { serviceStatus } from './status.ts'

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')
const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
}

let shell: string | null = null

async function shellHtml(): Promise<string> {
  shell ??= await readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
  return shell
}

/** Whether the address opens a page the caller may see. Everything else is the not-found page. */
async function pageExists(user: UserJson | null, pathname: string): Promise<boolean> {
  if (pathname === '/' || pathname === '/signin' || pathname === '/projects') return true
  const project = /^\/projects\/([^/]+)$/.exec(pathname)
  if (project) {
    if (!user) return false
    return loadAccess(user, project[1] as string).then(
      () => true,
      (error: unknown) => {
        if (error instanceof ApiError) return false
        throw error
      },
    )
  }
  const shared = /^\/s\/([^/]+)$/.exec(pathname)
  if (shared) {
    return resolveShare(shared[1] as string).then(
      () => true,
      (error: unknown) => {
        if (error instanceof ApiError) return false
        throw error
      },
    )
  }
  return false
}

export async function servePage(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const user = await currentUser({ req }).catch(() => null)
  const found = await pageExists(user, pathname)
  const status = await serviceStatus()
  const boot = JSON.stringify({ parseDelayMs: config.parseDelayMs, timeZone: config.timeZone, notFound: !found, user, status })
  const html = (await shellHtml()).replace('__BOOT__', boot.replace(/</g, '\\u003c'))
  res.writeHead(found ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(req.method === 'HEAD' ? undefined : html)
}

/** Serves a built asset from the public folder only: scripts, styles, fonts and the logo. */
export async function serveAsset(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const type = TYPES[path.extname(pathname)]
  const file = path.normalize(path.join(PUBLIC_DIR, pathname))
  if (!type || !file.startsWith(`${PUBLIC_DIR}${path.sep}`) || path.basename(file) === 'index.html') return false
  try {
    const bytes = await readFile(file)
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' })
    res.end(req.method === 'HEAD' ? undefined : bytes)
    return true
  } catch {
    return false
  }
}
