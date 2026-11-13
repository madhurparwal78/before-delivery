import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { config } from './config'
import { asApiError, fail } from './errors'
import { preferences } from './auth'
import { applySchema, pool, reachable } from './db'
import { baseSeed } from './seed'
import * as clock from './clock'
import { startListening } from './events'
import { startImages } from './images'
import { announceClock, settle } from './scheduler'
import { checkOrigin, context, ensureVisitor, match, send, sendError, sendText, type Ctx } from './http'
import { registerCore } from './routes-core'
import { registerBooking } from './routes-booking'
import { registerManage } from './routes-manage'
import { registerGrading } from './routes-grading'
import { canSee, loadRow } from './bookings'

registerCore()
registerBooking()
registerManage()
registerGrading()

const publicDir = join(__dirname, 'public')
const settings = JSON.stringify({ typeDebounceMs: config.typeDebounceMs, mapDebounceMs: config.mapDebounceMs, toastMs: config.toastMs, importMaxBytes: config.importMaxBytes })
const ARABIC_FONTS = ['400', '700'].map((weight) => `<link rel="preload" href="/fonts/ibm-plex-sans-arabic-arabic-${weight}-normal.woff2" as="font" type="font/woff2" crossorigin>\n`).join('')
const shell = (lang: string): string => readFileSync(join(publicDir, 'index.html'), 'utf8').replace('__SETTINGS__', settings).replace('__FONTS__', lang === 'ar' ? ARABIC_FONTS : '')
const types: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' }

const PAGES: RegExp[] = [
  /^\/$/, /^\/search$/, /^\/properties\/[^/]+$/, /^\/checkout\/[^/]+$/, /^\/bookings\/[^/]+$/, /^\/find$/, /^\/reviews\/[^/]+$/, /^\/inbox$/, /^\/account$/,
  /^\/signin$/, /^\/signup$/, /^\/moderation$/, /^\/manage\/[^/]+\/(calendar|reservations|import|statements)$/,
]

let ready = false

function serveStatic(path: string, res: ServerResponse): boolean {
  if (!/^\/(app\.(js|css)|fonts\/[\w.-]+)$/.test(path)) return false
  const file = normalize(join(publicDir, path))
  if (!file.startsWith(publicDir) || !existsSync(file) || !statSync(file).isFile()) return false
  const body = readFileSync(file)
  sendText(res, 200, types[extname(file)] ?? 'application/octet-stream', body, { 'cache-control': 'public, max-age=300' })
  return true
}

async function page(ctx: Ctx): Promise<void> {
  ensureVisitor(ctx)
  let status = PAGES.some((pattern) => pattern.test(ctx.path)) ? 200 : 404
  const booking = /^\/bookings\/([^/]+)$/.exec(ctx.path)
  if (booking && status === 200) {
    const row = await loadRow(pool, booking[1])
    if (!row || !(await canSee(pool, row, { visitor: ctx.identity.visitor, user: ctx.identity.user }))) status = 404
  }
  const manage = /^\/manage\/([^/]+)\//.exec(ctx.path)
  if (manage && status === 200 && ctx.identity.user && !ctx.identity.user.manages.includes(manage[1])) status = 404
  if (ctx.path === '/moderation' && ctx.identity.user && ctx.identity.user.role !== 'operator') status = 403
  const lang = ctx.query.get('lang') ?? (await preferences(ctx.identity)).lang
  sendText(ctx.res, status, 'text/html; charset=utf-8', shell(lang), { 'cache-control': 'no-store' })
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://local')
  if (url.pathname === '/api/health' && !ready) return send(res, 503, { status: 'starting' })
  try {
    checkOrigin(req)
    if (!ready) return send(res, 503, { status: 'starting' })
    await clock.refresh()
    void settle()
    if (url.search.includes('%00')) return fail(422, 'validation', { fields: { query: 'invalid' } })
    const ctx = await context(req, res, url)
    const found = match(ctx.method, ctx.path)
    if (found) {
      ctx.params = found.params
      await found.route.handler(ctx)
      return
    }
    if (ctx.path.startsWith('/api/')) return fail(404, 'not_found')
    if (ctx.method === 'GET' && serveStatic(ctx.path, res)) return
    if (ctx.method === 'GET') return await page(ctx)
    fail(404, 'not_found')
  } catch (error) {
    if (res.headersSent) return void res.end()
    sendError(res, asApiError(error))
  }
}

createServer((req, res) => void handle(req, res)).listen(config.port, '0.0.0.0')

async function boot(): Promise<void> {
  while (!(await reachable())) await new Promise((resolve) => setTimeout(resolve, 1000))
  await applySchema()
  await baseSeed()
  await clock.refresh()
  startListening()
  ready = true
  void startImages()
  setInterval(() => void settle().catch(() => undefined), 250).unref()
  setInterval(() => void announceClock().catch(() => undefined), 60000).unref()
}

process.on('unhandledRejection', (error) => console.error(error))

void boot().catch((error) => {
  console.error(error)
  process.exit(1)
})
