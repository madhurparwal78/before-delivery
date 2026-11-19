import { api, type InboxItem } from './api.js';
import { clear, el, on } from './dom.js';
import { onLive } from './live.js';
import { signedIn, state, viewport } from './state.js';
import { statusRegion, toastContainer } from './status.js';
import { navigate } from './router.js';

export function logoMark(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('class', 'logo-mark');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const left = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  left.setAttribute('cx', '12');
  left.setAttribute('cy', '16');
  left.setAttribute('r', '8');
  left.setAttribute('class', 'logo-mark__ink');
  const right = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  right.setAttribute('cx', '21');
  right.setAttribute('cy', '16');
  right.setAttribute('r', '8');
  right.setAttribute('class', 'logo-mark__coral');
  svg.appendChild(left);
  svg.appendChild(right);
  return svg;
}

export function chevron(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'chevron');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M4 6.5 L8 10.5 L12 6.5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.75');
  path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);
  return svg;
}

export function internalLink(label: string, href: string, cls = 'top-link'): HTMLAnchorElement {
  const link = el('a', { href, class: cls }, label);
  on(link, 'click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(href);
  });
  return link;
}

const MENUS: { label: string; columns: { heading: string; links: string[] }[] }[] = [
  {
    label: 'Work',
    columns: [
      { heading: 'Plan the week', links: ['Lists and sections', 'Boards', 'Timelines'] },
      { heading: 'Keep it moving', links: ['Automation rules', 'Formula fields', 'Approvals'] },
    ],
  },
  {
    label: 'Teams',
    columns: [
      { heading: 'Who it suits', links: ['Community kitchens', 'Makerspaces', 'Small offices'] },
      { heading: 'Ways in', links: ['Join with a team code', 'Public request forms'] },
    ],
  },
  {
    label: 'Learn',
    columns: [
      { heading: 'Get going', links: ['A first project', 'Repeat rules', 'Weighted goals'] },
      { heading: 'Go deeper', links: ['Workload and capacity', 'Rule chains', 'Project files'] },
    ],
  },
];

function signedOutHeader(): HTMLElement {
  const bar = el('header', { class: 'topbar topbar--welcome' });
  const brand = el('a', { href: '/', class: 'brand', 'aria-label': 'Everyweek home' }, [
    logoMark(),
    el('span', { class: 'wordmark' }, 'Everyweek'),
  ]);
  on(brand, 'click', (event) => {
    event.preventDefault();
    navigate('/');
  });
  const nav = el('nav', { class: 'mega-nav', 'aria-label': 'Workspace' });
  const panels: HTMLElement[] = [];
  for (const menu of MENUS) {
    const wrap = el('div', { class: 'mega' });
    const trigger = el(
      'button',
      { type: 'button', class: 'mega__trigger', 'aria-expanded': 'false' },
      [el('span', {}, menu.label), chevron()],
    );
    const panel = el(
      'div',
      { class: 'mega__panel', hidden: true },
      menu.columns.map((column) =>
        el('div', { class: 'mega__column' }, [
          el('p', { class: 'mega__heading' }, column.heading),
          el(
            'ul',
            { class: 'mega__list' },
            column.links.map((link) => el('li', {}, el('a', { href: '/account' }, link))),
          ),
        ]),
      ),
    );
    const closeMenu = () => {
      trigger.setAttribute('aria-expanded', 'false');
      panel.hidden = true;
    };
    on(trigger, 'click', () => {
      const open = trigger.getAttribute('aria-expanded') === 'true';
      for (const other of panels) other.hidden = true;
      for (const other of nav.querySelectorAll('.mega__trigger')) {
        other.setAttribute('aria-expanded', 'false');
      }
      if (!open) {
        trigger.setAttribute('aria-expanded', 'true');
        panel.hidden = false;
      }
    });
    on(wrap, 'keydown', (event) => {
      if (event.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
        event.preventDefault();
        closeMenu();
        trigger.focus();
      }
    });
    panels.push(panel);
    wrap.appendChild(trigger);
    wrap.appendChild(panel);
    nav.appendChild(wrap);
  }
  const actions = el('div', { class: 'topbar__actions' }, [
    internalLink('Log in', '/account', 'top-link'),
    internalLink('Try the sample form', '/f/supply-request', 'pill pill--outline'),
    internalLink('Get started', '/account', 'pill pill--dark'),
  ]);
  bar.appendChild(brand);
  bar.appendChild(nav);
  bar.appendChild(actions);
  return bar;
}

function inboxLink(): HTMLAnchorElement {
  const label = `Inbox, ${state.unread} unread`;
  const link = internalLink(label, '/inbox', 'top-link top-link--inbox');
  link.setAttribute('aria-label', label);
  link.dataset.inboxLink = 'true';
  return link;
}

function signedInHeader(): HTMLElement {
  const bar = el('header', { class: 'topbar' });
  const brand = el('a', { href: '/', class: 'brand', 'aria-label': 'Everyweek home' }, [
    logoMark(),
    el('span', { class: 'wordmark' }, 'Everyweek'),
  ]);
  on(brand, 'click', (event) => {
    event.preventDefault();
    navigate('/');
  });
  bar.appendChild(brand);

  const links = el('nav', { class: 'topbar__links', 'aria-label': 'Main' }, [
    internalLink('My work', '/'),
    internalLink('Goals', '/goals'),
    inboxLink(),
  ]);

  if (viewport() === 375) {
    const menuButton = el(
      'button',
      { type: 'button', class: 'pill pill--ghost topbar__menu', 'aria-expanded': 'false' },
      'Menu',
    );
    const panel = el('div', { class: 'topbar__drawer', hidden: true }, links);
    on(menuButton, 'click', () => {
      const open = menuButton.getAttribute('aria-expanded') === 'true';
      menuButton.setAttribute('aria-expanded', open ? 'false' : 'true');
      panel.hidden = open;
    });
    bar.appendChild(menuButton);
    bar.appendChild(panel);
  } else {
    bar.appendChild(links);
  }

  const account = el('div', { class: 'account-menu' });
  const trigger = el(
    'button',
    { type: 'button', class: 'pill pill--ghost', 'aria-expanded': 'false' },
    [el('span', {}, state.me.name ?? 'Account'), chevron()],
  );
  const panel = el('div', { class: 'account-menu__panel', hidden: true }, [
    internalLink('Account', '/account', 'menu-link'),
  ]);
  const signOut = el('button', { type: 'button', class: 'menu-link' }, 'Sign out');
  on(signOut, 'click', () => {
    void api
      .post('/api/signout')
      .catch(() => undefined)
      .finally(() => {
        window.location.href = '/';
      });
  });
  panel.appendChild(signOut);
  on(trigger, 'click', () => {
    const open = trigger.getAttribute('aria-expanded') === 'true';
    trigger.setAttribute('aria-expanded', open ? 'false' : 'true');
    panel.hidden = open;
  });
  on(account, 'keydown', (event) => {
    if (event.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
      trigger.setAttribute('aria-expanded', 'false');
      panel.hidden = true;
      trigger.focus();
    }
  });
  account.appendChild(trigger);
  account.appendChild(panel);
  bar.appendChild(account);
  return bar;
}

export function renderTopBar(): void {
  const host = document.getElementById('top-bar') as HTMLElement;
  clear(host);
  host.appendChild(signedIn() ? signedInHeader() : signedOutHeader());
  const live = document.getElementById('live') as HTMLElement;
  clear(live);
  live.appendChild(toastContainer());
  if (signedIn()) live.appendChild(statusRegion('Inbox status'));
}

function refreshInboxBadge(): void {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-inbox-link]')) {
    const label = `Inbox, ${state.unread} unread`;
    link.textContent = label;
    link.setAttribute('aria-label', label);
  }
}

export async function startInboxBadge(): Promise<void> {
  if (!signedIn()) return;
  const inbox = await api.get<{ unread: number; items: InboxItem[] }>('/api/inbox');
  state.unread = inbox.unread;
  refreshInboxBadge();
  onLive((event) => {
    if (event.type === 'inbox_item' && event.personId === state.me.id) {
      state.unread = Number(event.unread ?? state.unread);
      refreshInboxBadge();
      const item = event.item as InboxItem;
      const region = document.querySelector('[aria-label="Inbox status"]');
      if (region) region.textContent = `New in inbox: ${item.text}`;
    }
    if (event.type === 'inbox_updated' && event.personId === state.me.id) {
      state.unread = Number(event.unread ?? state.unread);
      refreshInboxBadge();
    }
  });
}

export function setUnread(count: number): void {
  state.unread = count;
  refreshInboxBadge();
}
