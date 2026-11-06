import type { Locale } from '../../shared/money.ts';
import { t } from '../../shared/strings.ts';
import type { SessionAccount } from '../http/context.ts';
import { esc, h, labelled, tel } from './html.ts';
import { icon } from './icons.ts';

export type PageOptions = {
  locale: Locale;
  page: string;
  title: string;
  account: SessionAccount | null;
  data?: Record<string, unknown>;
  bodyClass?: string;
  main: string;
  currentPath?: string;
};

function header(locale: Locale, account: SessionAccount | null, currentPath: string): string {
  const other: Locale = locale === 'en' ? 'fr' : 'en';
  const navLinks = [
    h('li', {}, tel('a', locale, 'nav_programme', undefined, { href: `/${locale}/` })),
    h('li', {}, tel('a', locale, 'nav_membership', undefined, { href: `/${locale}/membership` })),
    h('li', {}, tel('a', locale, 'nav_gift', undefined, { href: `/${locale}/gift` })),
    h('li', {}, tel('a', locale, 'nav_contact', undefined, { href: `/${locale}/contact` })),
    account === null
      ? h('li', {}, tel('a', locale, 'nav_signin', undefined, { href: `/${locale}/signin` }))
      : h(
          'li',
          {},
          tel('a', locale, account.role === 'patron' ? 'nav_account' : 'staff_heading', undefined, {
            href: account.role === 'patron' ? `/${locale}/account` : `/${locale}/staff`,
          }),
        ),
  ];
  return h(
    'header',
    { class: 'site-header' },
    h(
      'div',
      { class: 'header-inner' },
      h(
        'a',
        { href: `/${locale}/`, class: 'wordmark' },
        icon('aperture'),
        tel('span', locale, 'wordmark'),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'menu-button',
          id: 'menu-button',
          'aria-expanded': 'false',
          'aria-controls': 'primary-nav',
        },
        icon('menu'),
        tel('span', locale, 'menu'),
      ),
      h(
        'nav',
        { id: 'primary-nav', class: 'primary-nav', ...labelled(locale, 'nav_primary') },
        h('ul', {}, ...navLinks),
      ),
      h(
        'form',
        { method: 'get', action: `/locale/${other}`, class: 'lang-form', id: 'lang-form' },
        h('input', { type: 'hidden', name: 'next', value: currentPath }),
        h(
          'button',
          {
            type: 'submit',
            class: 'lang-button',
            id: 'lang-button',
            lang: other,
            'data-locale': other,
            'data-i18n': 'lang_button',
          },
          esc(t('lang_button', locale)),
        ),
      ),
    ),
  );
}

function noticeSlot(locale: Locale): string {
  return h(
    'div',
    { id: 'service-notice-slot', class: 'notice-slot' },
    h(
      'div',
      { id: 'service-notice', class: 'service-notice', role: 'alert', hidden: true, ...labelled(locale, 'service_notice') },
      h('div', { id: 'service-notice-body' }),
      tel('button', locale, 'dismiss_notice', undefined, {
        type: 'button',
        id: 'dismiss-notice',
        class: 'dismiss-notice',
      }),
    ),
  );
}

export function page(options: PageOptions): string {
  const { locale } = options;
  const bootstrap = JSON.stringify({ locale, page: options.page, ...(options.data ?? {}) });
  return `<!doctype html>
${h(
    'html',
    { lang: locale, 'data-page': options.page },
    h(
      'head',
      {},
      h('meta', { charset: 'utf-8' }),
      h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
      h('title', {}, esc(`${options.title} — ${t('wordmark', locale)}`)),
      h('link', { rel: 'stylesheet', href: '/app.css' }),
      h('script', { src: '/app.js', defer: true }),
    ),
    h(
      'body',
      { class: options.bodyClass ?? '' },
      tel('a', locale, 'skip_link', undefined, { href: '#main-heading', class: 'skip-link' }),
      header(locale, options.account, options.currentPath ?? `/${locale}/`),
      noticeSlot(locale),
      h('main', { id: 'main', class: 'site-main' }, options.main),
      h(
        'footer',
        { class: 'site-footer' },
        tel('p', locale, 'footer_line'),
      ),
      h('script', { type: 'application/json', id: 'page-data' }, bootstrap.replace(/</g, '\\u003c')),
    ),
  )}`;
}

export function heading(locale: Locale, key: string, args?: Record<string, string | number>): string {
  return tel('h1', locale, key, args, { id: 'main-heading', tabindex: '-1' });
}


export function statusRegions(locale: Locale, statusKey: string, errorKey: string): string {
  return h(
    'div',
    { class: 'feedback' },
    h('p', {
      id: 'form-status',
      role: 'status',
      'aria-live': 'polite',
      ...labelled(locale, statusKey),
    }),
    h('p', {
      id: 'form-error',
      role: 'alert',
      class: 'error-text',
      ...labelled(locale, errorKey),
    }),
  );
}


