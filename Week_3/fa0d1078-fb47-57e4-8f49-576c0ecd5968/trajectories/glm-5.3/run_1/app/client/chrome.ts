import { el, qs } from './dom.js';
import { session } from './session.js';

// Every page has one top-level heading, a main landmark and the Main
// navigation. The nav sits at the bottom left on Home, and in the topbar on
// the working screens.

export interface ChromeOptions {
  h1: string;
  path: string;
}

export function renderShell(opts: ChromeOptions, body: HTMLElement, footer: boolean): HTMLElement {
  const root = qs<HTMLElement>('#root');
  root.replaceChildren();

  const page = el('div', { class: 'page' });

  const topbar = el('header', { class: 'topbar' }, [
    el('a', { class: 'wordmark', href: '/' }, ['Seam']),
  ]);
  page.append(topbar);

  const main = el('main', { id: 'main' }, [body]);
  page.append(main);

  if (footer) {
    page.append(renderFooterNav(opts.path));
  }

  root.append(page);
  return page;
}

export function renderFooterNav(path: string): HTMLElement {
  const nav = el('nav', { class: 'footer-nav', 'aria-label': 'Main' });
  nav.append(...navLinks(path, true));
  return nav;
}

export function navLinks(path: string, footer: boolean): HTMLElement[] {
  const links: HTMLElement[] = [];
  const items: Array<[string, string]> = [
    ['Seam', '/'],
    ['Daily', '/daily'],
    ['Duel', '/duel'],
    ['Leaderboard', '/leaderboard'],
    ['Profile', '/profile'],
  ];
  for (const [label, href] of items) {
    const current = href === '/' ? path === '/' : path.startsWith(href);
    links.push(el('a', { href, 'aria-current': current ? 'page' : undefined }, [label]));
  }
  if (session.player) {
    const out = el('button', { class: 'link-button', type: 'button' }, ['Sign out']);
    out.addEventListener('click', async () => {
      await session.signOut();
      window.location.href = '/';
    });
    links.push(out);
  } else {
    links.push(el('a', { href: '/signin' }, ['Sign in']));
    links.push(el('a', { href: '/signup' }, ['Create account']));
  }
  void footer;
  return links;
}

export function topNav(path: string): HTMLElement {
  const nav = el('nav', { class: 'main-nav', 'aria-label': 'Main' });
  nav.append(...navLinks(path, false));
  return nav;
}

export function announcer(): HTMLElement {
  return el('div', { id: 'announcer', role: 'status', 'aria-live': 'polite' });
}

export function emailConfirmationRegion(onSendAgain: () => void): HTMLElement | null {
  if (!session.player || session.player.verified) return null;
  const region = el('section', { class: 'email-region', role: 'region', 'aria-label': 'Email confirmation' }, [
    el('p', {}, ['Confirm your email to join duels and the leaderboard.']),
    el('button', { class: 'button', type: 'button' }, ['Send again']),
  ]);
  region.querySelector('button')?.addEventListener('click', () => onSendAgain());
  return region;
}

export function notFoundPage(sentence: string): HTMLElement {
  return el('div', { class: 'not-found' }, [
    el('h1', {}, [sentence]),
  ]);
}
