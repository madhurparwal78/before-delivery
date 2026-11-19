import { observeEntrances, watchHeaderScroll } from './motion.js';
import { api } from './api.js';

export interface Me {
  id: string;
  username: string;
  display_name: string;
  email: string;
  roles: string[];
}

export async function loadMe(): Promise<Me | null> {
  const result = await api<Me>('GET', '/api/me');
  return result.ok ? result.body as Me : null;
}

export function headerRoleLinks(me: Me | null): void {
  const nav = document.querySelector<HTMLElement>('nav.main-nav');
  if (!nav) return;
  const studio = nav.querySelector<HTMLAnchorElement>('a[href="/studio"]');
  const library = nav.querySelector<HTMLAnchorElement>('a[href="/library"]');
  const consoleLink = nav.querySelector<HTMLAnchorElement>('a[href="/console"]');
  if (studio) studio.hidden = !(me?.roles.includes('creator') ?? false);
  if (library) library.hidden = !(me?.roles.includes('collector') ?? false);
  if (consoleLink) consoleLink.hidden = !(me?.roles.includes('founder-operator') ?? false);

  const signIn = document.querySelector<HTMLAnchorElement>('a[data-sign-in]');
  const account = document.querySelector<HTMLButtonElement>('button[data-account]');
  if (me) {
    if (signIn) signIn.hidden = true;
    if (account) {
      account.hidden = false;
      account.querySelector('span')!.textContent = me.display_name.split(' ')[0];
    }
    document.body.dataset.signedIn = 'true';
  } else {
    if (signIn) signIn.hidden = false;
    if (account) account.hidden = true;
    document.body.dataset.signedIn = 'false';
  }
}

export function bindHeaderMenu(): void {
  const toggle = document.querySelector<HTMLButtonElement>('button[data-menu-toggle]');
  const nav = document.querySelector<HTMLElement>('nav.main-nav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }
  });
  const account = document.querySelector<HTMLButtonElement>('button[data-account]');
  const menu = document.querySelector<HTMLElement>('div[data-account-menu]');
  account?.addEventListener('click', () => {
    if (!menu) return;
    const open = menu.hidden;
    menu.hidden = !open;
    account.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('click', (event) => {
    if (menu && !menu.hidden && account && !account.contains(event.target as Node) && !menu.contains(event.target as Node)) {
      menu.hidden = true;
    }
  });
}

export function pageInit(): void {
  watchHeaderScroll(document.querySelector('header.studio-header'));
  bindHeaderMenu();
  observeEntrances();
}

export function showStatus(region: HTMLElement | null, text: string): void {
  if (!region) return;
  region.textContent = text;
}

export function formatEditionCount(n: number | null): string {
  if (n === null) return '—';
  return String(n);
}
