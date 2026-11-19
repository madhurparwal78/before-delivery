import { el, icon, isNarrow } from './dom.js';
import { openDialog } from './dialog.js';
import { account, homeRoute } from './runtime.js';
import { noticeBand } from './notice.js';
import { statusRegion } from './status.js';
import { api } from './api.js';
import { navigate } from './router.js';

const NAV_LINKS: { label: string; href: string }[] = [
  { label: 'Editors', href: '/#editors' },
  { label: 'For classrooms', href: '/#for-classrooms' },
  { label: 'Starter projects', href: '/#starter-projects' },
  { label: 'Join a class', href: '/join' },
];

const mark = (): HTMLElement =>
  el('a', { href: '/', class: 'qy-mark', 'aria-label': 'Quarkyard home' }, [
    el('span', { class: 'qy-mark-glyph', 'aria-hidden': 'true', html: markSvg() }),
    el('span', { class: 'qy-wordmark', text: 'Quarkyard' }),
  ]);

const markSvg = (): string =>
  `<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false">
     <rect x="1" y="1" width="30" height="30" rx="8" fill="#ffffff" opacity="0.14" />
     <path d="M9 21 16 9l7 12z" fill="#ffffff" />
     <circle cx="16" cy="23" r="3" fill="#f08a24" />
   </svg>`;

const signOut = async (): Promise<void> => {
  await api.signout();
  window.location.assign('/');
};

const navList = (): HTMLElement =>
  el(
    'nav',
    { 'aria-label': 'Main', class: 'qy-nav' },
    NAV_LINKS.map((link) => el('a', { href: link.href, class: 'qy-nav-link', text: link.label })),
  );

const openMenu = (opener: HTMLElement): void => {
  openDialog({ label: 'Menu', opener, className: 'qy-dialog-menu' }, (handle) => {
    const current = account();
    const items: (Node | string)[] = [navList()];
    if (current) {
      const out = el('button', { type: 'button', class: 'qy-pill qy-pill-ghost', text: 'Sign out' });
      out.addEventListener('click', () => {
        void signOut();
      });
      items.push(out);
    } else {
      items.push(
        el('a', { href: '/signin', class: 'qy-pill qy-pill-outline', text: 'Sign in' }),
        el('a', { href: '/signup', class: 'qy-pill qy-pill-solid', text: 'Sign up' }),
      );
    }
    const close = el('button', { type: 'button', class: 'qy-pill qy-pill-quiet', text: 'Close' });
    close.addEventListener('click', handle.close);
    items.push(close);
    return [el('div', { class: 'qy-menu-body' }, items)];
  });
};

export const renderHeader = (): HTMLElement => {
  const current = account();
  const header = el('header', { role: 'banner', class: 'qy-header' });
  if (isNarrow()) {
    const menu = el('button', { type: 'button', class: 'qy-header-button', 'aria-label': 'Menu' }, [
      icon('menu'),
    ]);
    menu.append(el('span', { class: 'qy-sr-only', text: '' }));
    menu.addEventListener('click', () => openMenu(menu));
    header.append(
      el('div', { class: 'qy-header-inner qy-header-narrow' }, [
        menu,
        mark(),
        el('a', {
          href: current ? homeRoute() : '/signin',
          class: 'qy-header-link',
          text: 'Account',
        }),
      ]),
    );
    return header;
  }
  const right = el('div', { class: 'qy-header-right' });
  if (current) {
    right.append(
      el('span', { class: 'qy-header-name', text: current.nickname ?? current.displayName }),
      (() => {
        const out = el('button', { type: 'button', class: 'qy-pill qy-pill-ghost', text: 'Sign out' });
        out.addEventListener('click', () => {
          void signOut();
        });
        return out;
      })(),
    );
  } else {
    right.append(
      el('a', { href: '/signin', class: 'qy-pill qy-pill-outline', text: 'Sign in' }),
      el('a', { href: '/signup', class: 'qy-pill qy-pill-solid', text: 'Sign up' }),
    );
  }
  header.append(el('div', { class: 'qy-header-inner' }, [mark(), navList(), right]));
  return header;
};

export const buildShell = (): { main: HTMLElement; refreshHeader: () => void } => {
  const app = document.getElementById('qy-app');
  if (!app) throw new Error('Missing app root');
  app.replaceChildren();
  let header = renderHeader();
  const main = el('main', { id: 'qy-main', class: 'qy-main' });
  app.append(header, noticeBand(), main, statusRegion());

  const refreshHeader = (): void => {
    const next = renderHeader();
    header.replaceWith(next);
    header = next;
  };

  let wasNarrow = isNarrow();
  window.addEventListener('resize', () => {
    if (isNarrow() !== wasNarrow) {
      wasNarrow = isNarrow();
      refreshHeader();
    }
  });

  document.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest('a');
    if (!target) return;
    const href = target.getAttribute('href');
    if (!href || !href.startsWith('/') || target.hasAttribute('download') || target.target === '_blank') return;
    event.preventDefault();
    navigate(href);
  });

  return { main, refreshHeader };
};

export const editorLaunchPills = (): HTMLElement =>
  el('div', { class: 'qy-launch-row' }, [
    el('a', { href: '/editor/new?kind=3d', class: 'qy-pill qy-pill-solid qy-pill-3d', text: 'New 3D design' }),
    el('a', { href: '/editor/new?kind=circuit', class: 'qy-pill qy-pill-solid qy-pill-circuit', text: 'New circuit' }),
    el('a', { href: '/editor/new?kind=blocks', class: 'qy-pill qy-pill-solid qy-pill-blocks', text: 'New block program' }),
  ]);
