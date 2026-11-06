/**
 * The page chrome: the banner strip, the top bar, the account controls, the
 * phone menu sheet and the footer. Every page shares it.
 */

import * as api from './api.js';
import { el, announce } from './dom.js';
import { state } from './state.js';
import * as booking from './booking.js';
import { navigate } from './router.js';

export function buildChrome(): void {
  document.body.textContent = '';
  const banner = el(
    'div',
    { class: 'banner-strip' },
    el('a', { href: '/agenda', class: 'banner-link' }, 'Keel Outpost starts this week. Final seats →'),
  );
  const nav = el(
    'nav',
    { class: 'top-nav', 'aria-label': 'Main' },
    el('a', { href: '/', class: 'wordmark' }, 'Keel'),
    el('div', { class: 'nav-links' },
      el('a', { href: '/#overview' }, 'Overview'),
      el('a', { href: '/#experiences' }, 'Experiences'),
      el('a', { href: '/#tps-record' }, 'TPS Record'),
      el('a', { href: '/#agenda-chapter' }, 'Agenda'),
      el('a', { href: '/#speakers-chapter' }, 'Speakers'),
      el('a', { href: '/#sponsors' }, 'Sponsors'),
    ),
    el('div', { class: 'account-controls' }),
    el('button', { type: 'button', class: 'menu-button', 'aria-expanded': 'false', 'aria-haspopup': 'dialog' }, 'Menu'),
  );
  const accountBox = nav.querySelector('.account-controls') as HTMLElement;
  const regions = el('div', { class: 'live-regions' },
    el('p', { id: 'account-messages', role: 'status', 'aria-live': 'polite', 'aria-label': 'Account messages', class: 'live-region' }),
  );
  document.body.append(banner, nav, el('div', { id: 'app' }), regions, buildFooter());
  state.accountMessages = document.getElementById('account-messages');
  renderAccountControls(accountBox);
  nav.querySelector('.menu-button')!.addEventListener('click', () => {
    openMenu(nav.querySelector('.menu-button') as HTMLButtonElement);
  });
}

function buildFooter(): HTMLElement {
  return el(
    'footer',
    { role: 'contentinfo', class: 'footer' },
    'Keel Outpost 2026 · October 31 - November 1 · Harbour Quay Hall, Port Ashby. Questions about the programme: programme@example.com',
  );
}

export function renderAccountControls(box: HTMLElement): void {
  box.textContent = '';
  if (state.account === null) {
    box.append(el('a', { href: '/signin', class: 'signin-link' }, 'Sign in'));
    return;
  }
  box.append(el('span', { class: 'account-name' }, state.account.name));
  box.append(
    state.account.role === 'attendee'
      ? el('a', { href: '/my-agenda', class: 'my-agenda-link' }, 'My Agenda')
      : el('a', { href: '/organiser', class: 'organiser-link' }, 'Organiser'),
  );
  const out = el('button', { type: 'button', class: 'action signout' }, 'Sign out');
  out.addEventListener('click', () => {
    void doSignOut(out);
  });
  box.append(out);
}

async function doSignOut(button: HTMLButtonElement): Promise<void> {
  booking.setPending(button, true);
  announce(state.accountMessages, 'Signing out…');
  try {
    await api.signout();
  } catch {
    /* the token is refused locally even if the call failed */
  }
  api.storeToken(null);
  state.account = null;
  renderAccountControls(document.querySelector('.account-controls') as HTMLElement);
  announce(state.accountMessages, 'You are signed out.');
  booking.setPending(button, false);
  navigate('/agenda');
}

/** The phone and tablet menu sheet: a focus-trapping dialog. */
function openMenu(opener: HTMLButtonElement): void {
  const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Menu', class: 'menu-sheet' });
  const close = el('button', { type: 'button', class: 'menu-close' }, 'Close menu');
  const links: Array<[string, string]> = [
    ['Overview', '/#overview'],
    ['Experiences', '/#experiences'],
    ['TPS Record', '/#tps-record'],
    ['Agenda', '/#agenda-chapter'],
    ['Speakers', '/#speakers-chapter'],
    ['Sponsors', '/#sponsors'],
    ['My Agenda', '/my-agenda'],
    ['Speakers wall', '/speakers'],
  ];
  dialog.append(close, ...links.map(([label, href]) => el('a', { href, class: 'menu-link' }, label)));
  const backdrop = el('div', { class: 'dialog-backdrop' }, dialog);
  document.body.append(backdrop);
  const shut = (): void => {
    backdrop.remove();
    opener.setAttribute('aria-expanded', 'false');
    opener.focus();
  };
  close.addEventListener('click', shut);
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      shut();
    }
    trapTab(event, dialog);
  });
  opener.setAttribute('aria-expanded', 'true');
  close.focus();
}

/** Keep Tab inside an open dialog. */
export function trapTab(event: KeyboardEvent, dialog: HTMLElement): void {
  if (event.key !== 'Tab') return;
  const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
  if (focusables.length === 0) return;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
