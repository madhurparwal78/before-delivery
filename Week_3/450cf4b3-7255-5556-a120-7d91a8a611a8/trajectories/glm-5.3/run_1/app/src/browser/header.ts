import { api, state, el, clear, serverClock, api as call } from './lib.js';
import { announce } from './live.js';

// The header with navigation for the caller's role, the kitchen clock and the
// Menu disclosure below 600 px.

export interface Kitchen {
  name: string; timeZone: string; opensAt: string; closesAt: string;
  cleanupMinutes: number; minimumBookingMinutes: number; holdSeconds: number;
  today: string; now: string;
}

export interface HeaderHandle {
  clockText: HTMLElement;
  menuButton: HTMLButtonElement | null;
  menuPanel: HTMLElement | null;
}

export function navLinksForRole(role: string): Array<{ label: string; path: string }> {
  if (role === 'owner') {
    return [
      { label: 'Board', path: '/board' },
      { label: 'Tenants', path: '/tenants' },
      { label: 'Report', path: '/report' },
    ];
  }
  if (role === 'shift_lead') {
    return [{ label: 'Board', path: '/board' }];
  }
  return [
    { label: 'Board', path: '/board' },
    { label: 'Hour packs', path: '/packs' },
    { label: 'Documents', path: '/documents' },
  ];
}

export async function readKitchen(): Promise<Kitchen | null> {
  const r = await call('GET', '/api/kitchen');
  if (r.status === 200 && r.ok) {
    const k = r.ok as Kitchen;
    serverClock.update(k.now, k.timeZone);
    return k;
  }
  return null;
}

export function buildHeader(me: { role: string; displayName: string }): HeaderHandle {
  const header = el('header', { class: 'app-header' });
  const brand = el('div', { class: 'brand' }, 'Halfsheet Commissary');

  const nav = el('nav', { 'aria-label': 'Main', class: 'main-nav' });
  for (const link of navLinksForRole(me.role)) {
    nav.appendChild(el('a', { href: link.path, class: 'nav-link' }, link.label));
  }

  const signOut = el('button', {
    class: 'btn btn-ghost',
    onclick: async () => {
      await api('DELETE', '/api/session');
      state.me = null;
      state.sessionId = 'anon';
      announce('');
      history.replaceState(null, '', '/signin');
      const app = document.getElementById('app') as HTMLElement;
      const { showScreen } = await import('./app.js');
      await showScreen(app);
      const email = document.querySelector('input[type="email"]') as HTMLInputElement | null;
      if (email) email.focus();
    },
  }, 'Sign out');

  const menuPanel = el('div', { class: 'menu-panel', id: 'menu-panel', hidden: '' }, nav, signOut);
  const menuButton = el('button', {
    class: 'btn btn-ghost menu-button',
    'aria-expanded': 'false',
    'aria-controls': 'menu-panel',
    onclick: () => toggleMenu(menuButton, menuPanel),
  }, 'Menu') as HTMLButtonElement;

  const clockText = el('span', { class: 'clock-text' }, 'Kitchen time --:--');
  const clockWrap = el('div', { class: 'clock' }, clockText);

  header.append(brand, clockWrap, nav, signOut, menuButton, menuPanel);
  document.body.prepend(header);
  return { clockText, menuButton, menuPanel };
}

function toggleMenu(button: HTMLButtonElement, panel: HTMLElement): void {
  const open = button.getAttribute('aria-expanded') === 'true';
  if (open) {
    closeMenu(button, panel);
  } else {
    button.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    const first = panel.querySelector('a');
    if (first) (first as HTMLAnchorElement).focus();
  }
}

export function closeMenu(button: HTMLButtonElement, panel: HTMLElement): void {
  button.setAttribute('aria-expanded', 'false');
  panel.hidden = true;
}

export function startClockText(handle: HeaderHandle, zone: string): () => void {
  const tick = () => {
    const now = serverClock.now();
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(now));
    handle.clockText.textContent = `Kitchen time ${time} · ${zone}`;
  };
  tick();
  const timer = setInterval(tick, 10_000);
  return () => clearInterval(timer);
}

export function removeHeader(): void {
  const header = document.querySelector('header.app-header');
  if (header) header.remove();
}

export function screenHeading(text: string): HTMLElement {
  return el('h1', { class: 'screen-heading' }, text);
}

export { el, clear };
