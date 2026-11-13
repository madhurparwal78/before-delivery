import { api } from './api.js';
import { app, navigate } from './app.js';
import { el, openDialog } from './dom.js';
import type { AthleteSummary, Me } from '../domain/types.js';

function navLinks(me: Me, athletes: AthleteSummary[]): HTMLElement[] {
  if (me.role === 'athlete') {
    return [
      el('a', { class: 'nav-link', text: 'Calendar', attrs: { href: `/athletes/${me.id}` } }),
      el('a', {
        class: 'nav-link',
        text: 'Builder',
        attrs: { href: `/athletes/${me.id}/builder` },
      }),
      el('a', { class: 'nav-link', text: 'Coaches', attrs: { href: '/coaches' } }),
    ];
  }
  const dropdown = el('div', { class: 'nav-dropdown' });
  const panel = el('div', { class: 'nav-panel', attrs: { hidden: true } });
  for (const athlete of athletes) {
    panel.append(
      el('a', {
        class: 'nav-link',
        text: athlete.name,
        attrs: { href: `/athletes/${athlete.id}` },
      }),
    );
  }
  const toggle = el('button', {
    class: 'nav-link nav-toggle',
    text: 'Athletes',
    attrs: { type: 'button', 'aria-expanded': 'false' },
    on: {
      click: () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
        panel.hidden = open;
      },
    },
  });
  dropdown.append(toggle, panel);
  return [
    dropdown,
    el('a', { class: 'nav-link', text: 'Plans', attrs: { href: '/plans' } }),
    el('a', { class: 'nav-link', text: 'Inbox', attrs: { href: '/inbox' } }),
  ];
}

export async function renderHeader(me: Me): Promise<HTMLElement> {
  const athletes = me.role === 'coach' ? (await api.athletes()).athletes : [];
  const notices = el('p', {
    class: 'notices',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Notices' },
  });
  app.notices = notices;

  const nav = el('nav', { class: 'header-nav', children: navLinks(me, athletes) });

  const menuButton = el('button', {
    class: 'pill menu-button',
    text: 'Menu',
    attrs: { type: 'button' },
    on: {
      click: () => {
        openDialog({
          label: 'Menu',
          className: 'drawer',
          opener: menuButton,
          content: (handle) => [
            el('nav', {
              class: 'drawer-nav',
              children: navLinks(me, athletes).map((link) => {
                link.addEventListener('click', () => handle.close());
                return link;
              }),
            }),
          ],
        });
      },
    },
  });

  const switcher =
    me.role === 'coach'
      ? el('select', {
          class: 'athlete-switcher',
          attrs: { 'aria-label': 'Athlete' },
          on: {
            change: (event) => {
              const value = (event.target as HTMLSelectElement).value;
              if (value !== '') navigate(`/athletes/${value}`);
            },
          },
          children: [
            el('option', { text: 'Choose an athlete', attrs: { value: '' } }),
            ...athletes.map((athlete) =>
              el('option', { text: athlete.name, attrs: { value: athlete.id } }),
            ),
          ],
        })
      : null;

  const signOut = el('button', {
    class: 'pill pill-ink',
    text: 'Sign out',
    attrs: { type: 'button' },
    on: {
      click: async () => {
        await api.signOut();
        window.location.assign('/sign-in');
      },
    },
  });

  return el('header', {
    class: 'app-header',
    attrs: { role: 'banner' },
    children: [
      el('a', { class: 'wordmark', text: 'Ottermere Tempoline', attrs: { href: '/' } }),
      nav,
      menuButton,
      el('div', { class: 'header-right', children: [switcher, notices, signOut] }),
    ],
  });
}
