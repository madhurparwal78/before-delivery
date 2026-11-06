import { BANNERS, UI } from '../shared/copy.js';
import { otherLocale, setLocale } from './i18n.js';
import { navigate } from './router.js';
import { store } from './store.js';
import { bind, bindText, el, focusHeading, refresh, say } from './ui.js';

const NAV_LINKS = [
  { href: '/', text: UI.navDrop },
  { href: '/subscribe', text: UI.navSubscribe },
  { href: '/account', text: UI.navAccount },
  { href: '/contact', text: UI.navContact },
] as const;

function skipLink(): HTMLElement {
  const link = el('a', { class: 'skip-link', href: '#main' });
  bindText(link, () => say(UI.skipToContent));
  link.addEventListener('click', (event) => {
    event.preventDefault();
    focusHeading();
  });
  return link;
}

function languageToggle(): HTMLElement {
  const button = el('button', { type: 'button', class: 'language-toggle' });
  bindText(button, () => say(UI.languageToggle));
  button.addEventListener('click', () => {
    setLocale(otherLocale());
    refresh();
    button.focus();
  });
  return button;
}

function mainNavigation(): HTMLElement {
  const nav = el('nav', { class: 'main-nav' });
  bind(() => nav.setAttribute('aria-label', say(UI.mainNav)));
  const list = el('ul', { class: 'main-nav-list' });
  for (const entry of NAV_LINKS) {
    const link = el('a', { href: entry.href, class: 'nav-link' });
    bindText(link, () => say(entry.text));
    list.append(el('li', {}, [link]));
  }
  nav.append(list);
  return nav;
}

/** Outage banners: empty when all is well. */
function serviceStatus(path: string): HTMLElement {
  const region = el('div', { role: 'status', class: 'service-status' });
  bind(() => {
    region.setAttribute('aria-label', say(UI.serviceStatus));
    const down = store.status?.billing === 'down';
    const subscriptionArea = path.startsWith('/subscribe') || path.startsWith('/account');
    region.textContent = down
      ? say(subscriptionArea ? BANNERS.subscription : BANNERS.checkout)
      : '';
  });
  return region;
}

export function renderShell(path: string): { root: HTMLElement; main: HTMLElement } {
  const brand = el('span', { class: 'brand' });
  bindText(brand, () => say(UI.brand));
  const header = el('header', { class: 'site-header' }, [
    brand,
    mainNavigation(),
    languageToggle(),
  ]);
  const main = el('main', { id: 'main', class: 'site-main' });
  const footer = el('footer', { class: 'site-footer' });
  bindText(footer, () => say(UI.brand));
  const root = el('div', { class: 'site' }, [skipLink(), header, serviceStatus(path), main, footer]);
  return { root, main };
}

export function installLinkInterception(): void {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const anchor = (event.target as Element | null)?.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || !href.startsWith('/')) return;
    event.preventDefault();
    navigate(href);
  });
}
