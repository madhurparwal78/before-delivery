import type { Locale } from '../shared/locale.js';
import { s } from '../shared/strings.js';
import type { Role } from '../domain/session.js';
import { landingRoute } from '../domain/session.js';
import { esc, join, tag, voidTag } from './html.js';
import type { ServiceName } from '../services/health.js';

export interface LayoutOptions {
  readonly locale: Locale;
  readonly lang: string | null;
  readonly title: string;
  readonly role: Role | null;
  readonly bodyClass?: string;
  /** Client modules the page loads, relative to `/assets/js`. */
  readonly scripts?: readonly string[];
  /** The outage banner to show, if any. */
  readonly banner?: string | null;
  readonly head?: string;
}

/** Keeps the address's `lang` value on every internal link. */
export function link(path: string, lang: string | null): string {
  if (lang === null) return path;
  const [base, existing] = path.split('?', 2);
  const search = new URLSearchParams(existing ?? '');
  search.set('lang', lang);
  return `${base ?? path}?${search.toString()}`;
}

const AREA_LABEL: Readonly<Record<Role, 'areaStudio' | 'areaContribute' | 'areaStaff'>> = {
  author: 'areaStudio',
  editor: 'areaStudio',
  contributor: 'areaContribute',
  staff: 'areaStaff',
};

function topBar(options: LayoutOptions): string {
  const { locale, lang, role } = options;
  const picker = tag(
    'select',
    { class: 'language-picker', 'aria-label': s('language', locale), 'data-language-picker': 'true' },
    tag('option', { value: 'en', selected: locale === 'en' }, esc(s('english', locale))),
    tag('option', { value: 'de', selected: locale === 'de' }, esc(s('german', locale))),
  );

  const account =
    role === null
      ? tag('a', { class: 'top-link', href: link('/sign-in', lang) }, esc(s('signIn', locale)))
      : join(
          tag(
            'a',
            { class: 'top-link', href: link(landingRoute(role), lang) },
            esc(s(AREA_LABEL[role], locale)),
          ),
          tag(
            'form',
            { method: 'post', action: link('/sign-out', lang), class: 'inline-form' },
            tag('button', { type: 'submit', class: 'button-quiet' }, esc(s('signOut', locale))),
          ),
        );

  return tag(
    'header',
    { class: 'top-bar' },
    tag(
      'a',
      { class: 'wordmark', href: link('/catalogue', lang) },
      esc(s('wordmark', locale)),
    ),
    tag('a', { class: 'top-link', href: link('/catalogue', lang) }, esc(s('catalogueLink', locale))),
    picker,
    account,
  );
}

export function serviceBanner(copy: string, locale: Locale): string {
  return tag(
    'div',
    { role: 'region', 'aria-label': s('serviceStatus', locale), class: 'service-banner' },
    tag('p', {}, esc(copy)),
  );
}

const FONTS: readonly string[] = [
  'space-grotesk-latin-600-normal.woff2',
  'ibm-plex-sans-latin-400-normal.woff2',
  'ibm-plex-mono-latin-400-normal.woff2',
];

export function page(options: LayoutOptions, ...content: string[]): string {
  const { locale, title } = options;
  const preloads = FONTS.map((file) =>
    voidTag('link', {
      rel: 'preload',
      as: 'font',
      type: 'font/woff2',
      crossorigin: 'anonymous',
      href: `/assets/fonts/${file}`,
    }),
  ).join('');

  const scripts = (options.scripts ?? [])
    .map((src) => `<script type="module" src="/assets/js/client/${esc(src)}"></script>`)
    .join('');

  return join(
    '<!doctype html>',
    `<html lang="${locale}">`,
    tag(
      'head',
      {},
      voidTag('meta', { charset: 'utf-8' }),
      voidTag('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
      tag('title', {}, esc(title)),
      preloads,
      voidTag('link', { rel: 'stylesheet', href: '/assets/app.css' }),
      options.head ?? '',
    ),
    tag(
      'body',
      { class: options.bodyClass ?? '', 'data-locale': locale },
      topBar(options),
      options.banner == null ? '' : serviceBanner(options.banner, locale),
      tag('main', { class: 'page-main', id: 'main' }, ...content),
      '<script type="module" src="/assets/js/client/common.js"></script>',
      scripts,
    ),
    '</html>',
  );
}

/** The studio banner copy for whichever service is down. */
export function studioBannerCopy(down: readonly ServiceName[], locale: Locale): string | null {
  if (down.includes('storage')) return s('bannerStudioStorage', locale);
  if (down.includes('search')) return s('bannerStudioSearch', locale);
  if (down.includes('billing')) return s('bannerStudioBilling', locale);
  return null;
}
