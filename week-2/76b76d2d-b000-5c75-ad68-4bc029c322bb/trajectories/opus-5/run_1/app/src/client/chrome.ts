import type { Locale } from '../shared/money.ts';
import { call } from './api.ts';
import { applyTranslations, locale, setLocale, tr } from './i18n.ts';

export function focusHeading(): void {
  const heading = document.getElementById('main-heading');
  if (heading !== null) heading.focus();
}

function initSkipAndDismiss(): void {
  const skip = document.querySelector<HTMLAnchorElement>('.skip-link');
  skip?.addEventListener('click', (event) => {
    event.preventDefault();
    focusHeading();
  });
}

function initMenu(): void {
  const button = document.getElementById('menu-button');
  const nav = document.getElementById('primary-nav');
  if (button === null || nav === null) return;
  const sync = (): void => {
    const narrow = window.innerWidth < 768;
    if (!narrow) {
      nav.removeAttribute('hidden');
      button.setAttribute('aria-expanded', 'false');
      return;
    }
    if (button.getAttribute('aria-expanded') !== 'true') nav.setAttribute('hidden', '');
  };
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', open ? 'false' : 'true');
    if (open) nav.setAttribute('hidden', '');
    else nav.removeAttribute('hidden');
  });
  window.addEventListener('resize', sync);
  sync();
}

function swapLocalePath(path: string, next: Locale): string {
  if (/^\/(en|fr)(\/|$)/.test(path)) return path.replace(/^\/(en|fr)/, `/${next}`);
  return `/${next}${path}`;
}

function initLanguage(): void {
  const button = document.getElementById('lang-button');
  if (button === null) return;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    const next = (button.getAttribute('data-locale') ?? 'fr') as Locale;
    const previous = locale();
    setLocale(next);
    document.documentElement.lang = next;
    button.setAttribute('data-locale', previous);
    button.setAttribute('lang', previous);
    const form = document.getElementById('lang-form');
    form?.setAttribute('action', `/locale/${previous}`);
    applyTranslations();
    const url = new URL(window.location.href);
    url.pathname = swapLocalePath(url.pathname, next);
    window.history.replaceState({}, '', url);
    void call('POST', '/api/locale', { locale: next }).catch(() => undefined);
  });
}

let dismissedBilling = false;
let dismissedMail = false;
let lastBilling = 'up';
let lastMail = 'up';

function renderNotice(billing: string, mail: string): void {
  const notice = document.getElementById('service-notice');
  const body = document.getElementById('service-notice-body');
  if (notice === null || body === null) return;
  if (billing !== lastBilling) dismissedBilling = false;
  if (mail !== lastMail) dismissedMail = false;
  lastBilling = billing;
  lastMail = mail;
  const paragraphs: string[] = [];
  if (billing === 'down' && !dismissedBilling) paragraphs.push('billing_notice');
  if (mail === 'down' && !dismissedMail) paragraphs.push('mail_notice');
  body.textContent = '';
  for (const key of paragraphs) {
    const paragraph = document.createElement('p');
    paragraph.setAttribute('data-i18n', key);
    paragraph.textContent = tr(key);
    body.append(paragraph);
  }
  notice.hidden = paragraphs.length === 0;
  document.body.classList.toggle('billing-down', billing === 'down');
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-billing-sensitive]')) {
    button.disabled = billing === 'down' || button.getAttribute('data-locked') === '1';
  }
}

function initNotices(): void {
  const dismiss = document.getElementById('dismiss-notice');
  dismiss?.addEventListener('click', () => {
    if (lastBilling === 'down') dismissedBilling = true;
    if (lastMail === 'down') dismissedMail = true;
    renderNotice(lastBilling, lastMail);
    focusHeading();
  });
  const poll = async (): Promise<void> => {
    const status = await call<{ billing: string; mail: string }>('GET', '/api/status');
    renderNotice(status.billing, status.mail);
  };
  void poll().catch(() => undefined);
  window.setInterval(() => {
    void poll().catch(() => undefined);
  }, 5000);
}

export function initChrome(pageLocale: Locale): void {
  setLocale(pageLocale);
  initSkipAndDismiss();
  initMenu();
  initLanguage();
  initNotices();
}

export function billingDown(): boolean {
  return lastBilling === 'down';
}
