import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { env } from './env.ts';
import { migrate, schemaReady } from './db/migrate.ts';
import { ensureCatalogUploaded, probeBilling } from './killbill/client.ts';
import { startOutboxWorker } from './mail/outbox.ts';
import { purgeOldKeys } from './http/idempotency.ts';
import { ApiError } from './http/errors.ts';
import { dispatch } from './http/router.ts';
import { sendApiError, sendHtml, sendRedirect, setCookie } from './http/respond.ts';
import {
  GUEST_COOKIE,
  LOCALE_COOKIE,
  SESSION_COOKIE,
  checkContentType,
  isLocale,
  loadSession,
  parseCookies,
  parseJsonBody,
  readBody,
  resolveLocale,
  type Ctx,
} from './http/context.ts';
import { isSafePath } from './http/safepath.ts';
import { renderPage } from './pages.ts';
import { page } from './views/layout.ts';
import { notFoundMain } from './views/pages.ts';
import { t } from '../shared/strings.ts';
import type { Locale } from '../shared/money.ts';

import './api/public.ts';
import './api/booking.ts';
import './api/member.ts';
import './api/staff.ts';

const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveAsset(path: string, res: ServerResponse): Promise<boolean> {
  const extension = extname(path);
  if (CONTENT_TYPES[extension] === undefined) return false;
  const relative = normalize(path).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^\/+/, '');
  if (relative.split('/').some((segment) => segment.startsWith('.'))) return false;
  try {
    const body = await readFile(join(PUBLIC_DIR, relative));
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extension],
      'Content-Length': body.length,
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

function localeRoute(url: URL, res: ServerResponse): void {
  const locale = url.pathname.split('/')[2];
  if (!isLocale(locale)) {
    sendRedirect(res, 303, '/en/');
    return;
  }
  setCookie(res, LOCALE_COOKIE, locale, { httpOnly: false });
  const next = url.searchParams.get('next');
  if (next === null || !isSafePath(next)) {
    sendRedirect(res, 303, `/${locale}/`);
    return;
  }
  const decoded = decodeURIComponent(next);
  const swapped = /^\/(en|fr)(\/|$)/.test(decoded)
    ? decoded.replace(/^\/(en|fr)/, `/${locale}`)
    : `/${locale}${decoded}`;
  sendRedirect(res, 303, swapped);
}

function pageLocaleOf(pathname: string): { locale: Locale; rest: string } | null {
  const match = /^\/(en|fr)(\/.*)?$/.exec(pathname);
  if (match === null) return null;
  return { locale: match[1] as Locale, rest: match[2] ?? '/' };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';
  const cookies = parseCookies(req.headers.cookie);
  const pathname = decodeURI(url.pathname);

  if (method === 'GET' && !pathname.startsWith('/api/')) {
    if (await serveAsset(pathname, res)) return;
  }

  const account = await loadSession(cookies[SESSION_COOKIE]);
  let guestKey = cookies[GUEST_COOKIE] ?? null;
  if (guestKey === null && account === null) {
    guestKey = randomBytes(16).toString('base64url');
    setCookie(res, GUEST_COOKIE, guestKey);
  }

  const headerLocale = req.headers['x-halide-locale'];
  const apiLocale = resolveLocale({
    header: typeof headerLocale === 'string' ? headerLocale : undefined,
    cookie: cookies[LOCALE_COOKIE],
    account: account?.locale ?? null,
    acceptLanguage: req.headers['accept-language'],
  });

  if (pathname.startsWith('/api/')) {
    let rawBody = '';
    const ctx: Ctx = {
      req,
      res,
      method,
      url,
      path: pathname,
      cookies,
      locale: apiLocale,
      body: {},
      rawBody: '',
      params: {},
      account,
      sessionToken: cookies[SESSION_COOKIE] ?? null,
      guestKey,
      setCookies: [],
    };
    try {
      rawBody = await readBody(req);
      ctx.rawBody = rawBody;
      checkContentType(req, rawBody);
      ctx.body = parseJsonBody(rawBody);
      const origin = req.headers.origin;
      if (
        origin !== undefined &&
        method !== 'GET' &&
        method !== 'HEAD' &&
        origin !== `http://${req.headers.host ?? ''}` &&
        origin !== `https://${req.headers.host ?? ''}`
      ) {
        throw new ApiError('cross_origin');
      }
      const handled = await dispatch(ctx);
      if (!handled) throw new ApiError('not_found');
    } catch (error) {
      if (error instanceof ApiError) {
        sendApiError(res, error, ctx.locale);
        return;
      }
      process.stderr.write(`request failed: ${String(error)}\n`);
      sendApiError(res, new ApiError('not_found'), ctx.locale);
    }
    return;
  }

  if (pathname === '/locale' || pathname.startsWith('/locale/')) {
    localeRoute(url, res);
    return;
  }

  const pageLocale = pageLocaleOf(pathname);
  if (pageLocale === null) {
    if (pathname === '/' || !pathname.startsWith('/api')) {
      const target = resolveLocale({
        cookie: cookies[LOCALE_COOKIE],
        account: account?.locale ?? null,
        acceptLanguage: req.headers['accept-language'],
      });
      sendRedirect(res, 303, `/${target}/${pathname === '/' ? '' : pathname.replace(/^\//, '')}${url.search}`);
      return;
    }
    sendHtml(res, 404, page({ locale: apiLocale, page: 'not-found', title: 'Halide', account, main: notFoundMain(apiLocale) }));
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    sendHtml(
      res,
      405,
      page({
        locale: pageLocale.locale,
        page: 'not-found',
        title: t('err_method_not_allowed', pageLocale.locale),
        account,
        main: notFoundMain(pageLocale.locale),
      }),
    );
    return;
  }

  setCookie(res, LOCALE_COOKIE, pageLocale.locale, { httpOnly: false });
  const ctx: Ctx = {
    req,
    res,
    method,
    url,
    path: pathname,
    cookies,
    locale: pageLocale.locale,
    body: {},
    rawBody: '',
    params: {},
    account,
    sessionToken: cookies[SESSION_COOKIE] ?? null,
    guestKey,
    setCookies: [],
  };
  try {
    await renderPage(ctx, pageLocale.locale, pageLocale.rest);
  } catch (error) {
    process.stderr.write(`page failed: ${String(error)}\n`);
    sendHtml(
      res,
      500,
      page({
        locale: pageLocale.locale,
        page: 'not-found',
        title: 'Halide',
        account,
        main: notFoundMain(pageLocale.locale),
      }),
    );
  }
}

const server = createServer((req, res) => {
  void handle(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

server.listen(env.port, '0.0.0.0', () => {
  process.stdout.write(`halide box office listening on ${env.port}\n`);
});

void migrate().then(() => {
  startOutboxWorker();
  setInterval(() => {
    void purgeOldKeys().catch(() => undefined);
  }, 60000);
});

async function catalogueLoop(): Promise<void> {
  for (;;) {
    try {
      if (await ensureCatalogUploaded()) return;
    } catch {
      /* retried below */
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

void catalogueLoop();
setInterval(() => {
  void probeBilling().catch(() => undefined);
}, 5000);
void probeBilling().catch(() => undefined);

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

export { schemaReady };
