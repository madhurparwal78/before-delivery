import type { Locale } from '../locales.js';
import { t } from '../locales.js';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function attrs(value: string): string {
  return escapeHtml(value);
}

export interface PageContext {
  locale: Locale;
  path: string;
  query: URLSearchParams;
  user: { role: string; email: string } | null;
  services: { search: boolean; storage: boolean; billing: boolean };
  script: string;
  title: string;
  clientCopy: Record<string, string>;
}

export function langParam(ctx: { query: URLSearchParams }): string {
  const lang = ctx.query.get('lang');
  return lang === 'de' ? 'lang=de' : lang === 'en' ? 'lang=en' : '';
}

export function withLang(path: string, lang: string): string {
  if (lang === '') return path;
  return path.includes('?') ? `${path}&${lang}` : `${path}?${lang}`;
}

export function layout(ctx: PageContext, main: string, options: { bodyClass?: string } = {}): string {
  const l = ctx.locale;
  const areaLink = ctx.user === null ? '' : areaLinkOf(ctx);
  const serviceBanner = serviceBannerOf(ctx, l);
  return `<!doctype html>
<html lang="${l === 'en' ? 'en' : 'de'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(ctx.title)} · ${t(l, 'brand')}</title>
<link rel="stylesheet" href="/assets/styles.css">
<link rel="preload" href="/fonts/space-grotesk-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<script>window.TS = ${JSON.stringify({ locale: l, copy: ctx.clientCopy, user: ctx.user?.role ?? null })};</script>
</head>
<body class="${options.bodyClass ?? ''}">
${topBar(ctx, areaLink)}
${serviceBanner}
<main id="main">
${main}
</main>
${ctx.script === '' ? '' : `<script type="module" src="${ctx.script}"></script>`}
</body>
</html>`;
}

function topBar(ctx: PageContext, areaLink: string): string {
  const l = ctx.locale;
  const lang = langParam(ctx);
  const catalogueHref = withLang('/catalogue', lang);
  const currentLang = l === 'en' ? 'English' : 'Deutsch';
  const signedOut = ctx.user === null;
  const signIn = signedOut ? `<a class="nav-link" href="${withLang('/sign-in', lang)}">${t(l, 'nav.sign_in')}</a>` : '';
  const signOut = signedOut ? '' : `<button type="button" class="nav-button" id="sign-out">${t(l, 'nav.sign_out')}</button>`;
  return `<header class="topbar">
  <div class="topbar-inner">
    <a class="wordmark" href="${catalogueHref}">${t(l, 'brand')}</a>
    <nav class="topnav" aria-label="${t(l, 'nav.catalogue')}">
      <a class="nav-link" href="${catalogueHref}">${t(l, 'nav.catalogue')}</a>
      ${areaLink}
      <label class="language-picker">
        <span class="visually-hidden">${t(l, 'nav.language')}</span>
        <select id="language-picker" aria-label="${t(l, 'nav.language')}">
          <option value="en"${l === 'en' ? ' selected' : ''}>English</option>
          <option value="de"${l === 'de' ? ' selected' : ''}>Deutsch</option>
        </select>
      </label>
      ${signIn}
      ${signOut}
    </nav>
  </div>
</header>`;
}

function areaLinkOf(ctx: PageContext): string {
  const l = ctx.locale;
  const lang = langParam(ctx);
  const href = ctx.user === null ? '' : withLang(areaHref(ctx.user.role), lang);
  return `<a class="nav-link" href="${href}">${t(l, `nav.area.${ctx.user?.role === 'staff' ? 'staff' : ctx.user?.role ?? 'author'}`)}</a>`;
}

export function areaHref(role: string): string {
  if (role === 'author') return '/studio';
  if (role === 'editor') return '/studio/review';
  if (role === 'contributor') return '/contribute';
  if (role === 'staff') return '/staff';
  return '/catalogue';
}

function serviceBannerOf(ctx: PageContext, l: Locale): string {
  const messages: string[] = [];
  if (ctx.services.search) messages.push(t(l, ctx.path === '/catalogue' || ctx.path.startsWith('/models/') ? 'outage.search_catalogue' : 'outage.search_studio'));
  if (ctx.services.storage) messages.push(t(l, 'outage.storage_studio'));
  if (ctx.services.billing) messages.push(t(l, 'outage.billing_studio'));
  if (messages.length === 0) return '';
  return `<section class="service-status" role="region" aria-label="${t(l, 'service.up')}">
  <p>${messages.map(escapeHtml).join('</p><p>')}</p>
</section>`;
}

export function baseClientCopy(l: Locale): Record<string, string> {
  const keys = [
    'brand', 'nav.catalogue', 'nav.language', 'nav.sign_in', 'nav.sign_out', 'nav.area.author', 'nav.area.editor',
    'nav.area.contributor', 'nav.area.staff', 'error.summary_title', 'common.save', 'common.loading',
  ];
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = t(l, key);
  return out;
}
