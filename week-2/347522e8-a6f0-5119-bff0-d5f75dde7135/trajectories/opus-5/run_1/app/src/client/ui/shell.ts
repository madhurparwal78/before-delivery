/**
 * The signed-in page shell: the product name, the main navigation and Sign out.
 * Below 768 pixels the links sit in a drawer behind a Menu button, and while it
 * is closed they are not visible, not reachable by Tab and not in the
 * accessibility tree.
 */

import { BRAND_NAME, PRODUCT_NAME } from '../../shared/copy.js';
import type { SessionUser } from '../../shared/types.js';
import { el, icon, isPhoneBand } from '../dom.js';
import { signOut } from '../session.js';

interface NavLink {
  href: string;
  label: string;
}

function linksFor(user: SessionUser): NavLink[] {
  const links: NavLink[] = [];
  if (user.role === 'renter') {
    links.push({ href: '/board', label: 'Board' });
    links.push({ href: '/kitchen', label: 'My kitchen' });
  } else {
    links.push({ href: '/board', label: 'Board' });
    if (user.role === 'operator') links.push({ href: '/operator', label: 'Operator' });
    links.push({ href: '/shift', label: 'Shift' });
  }
  return links;
}

export interface Shell {
  element: HTMLElement;
  main: HTMLElement;
}

export function buildShell(user: SessionUser, currentPath: string): Shell {
  const nav = el('nav', { class: 'nav', attrs: { 'aria-label': 'Main' } });
  for (const link of linksFor(user)) {
    nav.append(
      el('a', {
        text: link.label,
        attrs: {
          href: link.href,
          'aria-current': link.href === currentPath ? 'page' : null,
        },
      }),
    );
  }

  const menuButton = el(
    'button',
    {
      class: 'btn menu-button',
      attrs: { type: 'button', 'aria-expanded': 'false' },
    },
    [icon('menu'), el('span', { text: 'Menu' })],
  );

  const signOutButton = el(
    'button',
    { class: 'btn', attrs: { type: 'button' } },
    [icon('log-out'), el('span', { text: 'Sign out' })],
  );
  signOutButton.addEventListener('click', () => {
    void signOut();
  });

  let open = false;

  const applyVisibility = (): void => {
    const phone = isPhoneBand();
    nav.hidden = phone && !open;
    nav.classList.toggle('nav--open', phone && open);
    menuButton.setAttribute('aria-expanded', String(phone && open));
  };

  const setOpen = (next: boolean, restoreFocus: boolean): void => {
    open = next;
    applyVisibility();
    if (open) {
      nav.querySelector<HTMLElement>('a')?.focus();
    } else if (restoreFocus) {
      menuButton.focus();
    }
  };

  menuButton.addEventListener('click', () => setOpen(!open, true));

  nav.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a')) setOpen(false, false);
  });

  const header = el('header', { class: 'masthead' }, [
    el('div', { class: 'masthead__brand' }, [
      el('span', { text: BRAND_NAME }),
      document.createTextNode(PRODUCT_NAME),
    ]),
    menuButton,
    nav,
    signOutButton,
  ]);

  // While the drawer is open, Tab and Shift+Tab cycle only through Menu and the links.
  header.addEventListener('keydown', (event) => {
    if (!open || !isPhoneBand()) return;
    if (event.key === 'Escape') {
      setOpen(false, true);
      return;
    }
    if (event.key !== 'Tab') return;
    const ring = [menuButton, ...nav.querySelectorAll<HTMLElement>('a')];
    const index = ring.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    event.preventDefault();
    const next = event.shiftKey ? index - 1 : index + 1;
    ring[(next + ring.length) % ring.length].focus();
  });

  const media = window.matchMedia('(max-width: 767.98px)');
  media.addEventListener('change', () => {
    open = false;
    applyVisibility();
  });
  applyVisibility();

  const main = el('main', { class: 'main' });
  return { element: el('div', { class: 'shell' }, [header, main]), main };
}
