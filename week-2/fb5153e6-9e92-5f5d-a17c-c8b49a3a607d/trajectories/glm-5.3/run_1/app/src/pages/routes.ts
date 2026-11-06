import { Router, type RequestContext } from '../http/types.js';
import { ApiError } from '../errors.js';
import { sendRaw } from '../http/respond.js';
import { registerPageRenderer } from '../server.js';
import { localeFromLangParam, fullCopy, t, type Locale } from '../locales.js';
import { serviceUp, type ServiceName } from '../providers/availability.js';
import { currentUser } from '../api/session.js';
import { escapeHtml, layout, type PageContext } from './render.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ASSET_DIR = join(process.cwd(), 'dist', 'client');

export function registerPageRoutes(router: Router): void {
  router.add({ method: 'GET', pattern: '/', allowedParams: null, handler: redirectRoot });
  router.add({ method: 'GET', pattern: '/catalogue', allowedParams: null, handler: ctx => page(ctx, 'catalogue') });
  router.add({ method: 'GET', pattern: '/models/:slug', allowedParams: null, handler: ctx => page(ctx, 'model') });
  router.add({ method: 'GET', pattern: '/u/:token', allowedParams: null, handler: ctx => page(ctx, 'share') });
  router.add({ method: 'GET', pattern: '/embed/:token', allowedParams: null, handler: ctx => page(ctx, 'embed') });
  router.add({ method: 'GET', pattern: '/receipts/:token', allowedParams: null, handler: ctx => page(ctx, 'receipt') });
  router.add({ method: 'GET', pattern: '/sign-in', allowedParams: null, handler: ctx => page(ctx, 'signin') });
  router.add({ method: 'GET', pattern: '/studio', allowedParams: null, handler: ctx => page(ctx, 'studio') });
  router.add({ method: 'GET', pattern: '/studio/upload', allowedParams: null, handler: ctx => page(ctx, 'studio-upload') });
  router.add({ method: 'GET', pattern: '/studio/review', allowedParams: null, handler: ctx => page(ctx, 'studio-review') });
  router.add({ method: 'GET', pattern: '/studio/collections', allowedParams: null, handler: ctx => page(ctx, 'studio-collections') });
  router.add({ method: 'GET', pattern: '/studio/plan', allowedParams: null, handler: ctx => page(ctx, 'studio-plan') });
  router.add({ method: 'GET', pattern: '/studio/api-keys', allowedParams: null, handler: ctx => page(ctx, 'studio-keys') });
  router.add({ method: 'GET', pattern: '/studio/export', allowedParams: null, handler: ctx => page(ctx, 'studio-export') });
  router.add({ method: 'GET', pattern: '/studio/models/:slug', allowedParams: null, handler: ctx => page(ctx, 'studio-model') });
  router.add({ method: 'GET', pattern: '/studio/models/:slug/queue', allowedParams: null, handler: ctx => page(ctx, 'studio-queue') });
  router.add({ method: 'GET', pattern: '/contribute', allowedParams: null, handler: ctx => page(ctx, 'contribute') });
  router.add({ method: 'GET', pattern: '/contribute/models/:slug', allowedParams: null, handler: ctx => page(ctx, 'contrib-queue') });
  router.add({ method: 'GET', pattern: '/staff', allowedParams: null, handler: ctx => page(ctx, 'staff') });
  router.add({ method: 'GET', pattern: '/staff/orders/:ref', allowedParams: null, handler: ctx => page(ctx, 'staff-order') });
  router.add({ method: 'GET', pattern: '/assets/:name', allowedParams: null, handler: serveAsset });
  router.add({ method: 'GET', pattern: '/fonts/:name', allowedParams: null, handler: serveFont });

  registerPageRenderer({ renderErrorPage });
}

async function redirectRoot(ctx: RequestContext): Promise<void> {
  const lang = ctx.query.get('lang') === 'de' ? '?lang=de' : ctx.query.get('lang') === 'en' ? '?lang=en' : '';
  ctx.res.statusCode = 302;
  ctx.res.setHeader('Location', `/catalogue${lang}`);
  ctx.res.end();
}

async function page(ctx: RequestContext, pageName: string): Promise<void> {
  const { renderPage } = await import('./render-page.js');
  const user = await currentUser(ctx).catch(() => null);
  const locale = localeFromLangParam(ctx.query.get('lang'), 'en');
  const pageCtx: PageContext = {
    locale,
    path: ctx.path,
    query: ctx.query,
    user: user === null ? null : { role: user.role, email: user.email },
    services: {
      search: !serviceUp('search'),
      storage: !serviceUp('storage'),
      billing: !serviceUp('billing'),
    },
    script: scriptFor(pageName, locale),
    title: '',
    clientCopy: fullCopy(locale),
  };
  const outcome = await renderPage(pageName, pageCtx, ctx);
  if (outcome === null) throw new ApiError(404, 'not_found');
  const csp = ctx.path.startsWith('/embed/') ? 'frame-ancestors *' : "frame-ancestors 'self'";
  sendRaw(ctx, outcome.status, outcome.html, 'text/html; charset=utf-8', { 'Content-Security-Policy': csp });
}

function scriptFor(pageName: string, locale: Locale): string {
  void locale;
  const scripts: Record<string, string> = {
    catalogue: '/assets/catalogue.js',
    model: '/assets/model.js',
    share: '/assets/model.js',
    embed: '/assets/model.js',
    receipt: '/assets/receipt.js',
    signin: '/assets/session.js',
    studio: '/assets/studio.js',
    'studio-upload': '/assets/studio.js',
    'studio-review': '/assets/studio.js',
    'studio-collections': '/assets/studio.js',
    'studio-plan': '/assets/studio.js',
    'studio-keys': '/assets/studio.js',
    'studio-export': '/assets/studio.js',
    'studio-model': '/assets/model.js',
    'studio-queue': '/assets/queue.js',
    contribute: '/assets/studio.js',
    'contrib-queue': '/assets/queue.js',
    staff: '/assets/staff.js',
    'staff-order': '/assets/staff.js',
  };
  return scripts[pageName] ?? '/assets/app.js';
}

const ASSET_TYPES: Record<string, string> = {
  js: 'text/javascript',
  css: 'text/css',
  woff2: 'font/woff2',
  png: 'image/png',
  svg: 'image/svg+xml',
  json: 'application/json',
};

async function serveAsset(ctx: RequestContext): Promise<void> {
  const name = ctx.params['name'] ?? '';
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new ApiError(404, 'not_found');
  const path = join(ASSET_DIR, name);
  if (!path.startsWith(ASSET_DIR) || !existsSync(path)) throw new ApiError(404, 'not_found');
  const ext = name.split('.').pop() ?? '';
  sendRaw(ctx, 200, readFileSync(path), ASSET_TYPES[ext] ?? 'application/octet-stream', {
    'Cache-Control': 'public, max-age=60',
    'X-Content-Type-Options': 'nosniff',
  });
}

async function serveFont(ctx: RequestContext): Promise<void> {
  const name = ctx.params['name'] ?? '';
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new ApiError(404, 'not_found');
  const path = join(ASSET_DIR, 'fonts', name);
  if (!path.startsWith(ASSET_DIR) || !existsSync(path)) throw new ApiError(404, 'not_found');
  sendRaw(ctx, 200, readFileSync(path), 'font/woff2', {
    'Cache-Control': 'public, max-age=86400',
  });
}

function renderErrorPage(err: ApiError): string {
  const l: Locale = 'en';
  const code = err.code;
  const copy = t(l, code === 'not_found' ? 'not_found' : code === 'forbidden' ? 'forbidden' : code === 'unauthenticated' ? 'login.required' : code, err.fields !== undefined ? undefined : undefined);
  void copy;
  const message =
    code === 'not_found'
      ? t(l, 'not_found')
      : code === 'forbidden'
        ? t(l, 'forbidden')
        : code === 'unauthenticated'
          ? t(l, 'login.required')
          : t(l, code);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(message)} · ${t(l, 'brand')}</title>
<link rel="stylesheet" href="/assets/styles.css"></head>
<body>
<main class="error-page" role="main">
  <h1>${escapeHtml(message)}</h1>
  <p><a href="/catalogue">${t(l, 'nav.catalogue')}</a></p>
</main>
</body>
</html>`;
}
