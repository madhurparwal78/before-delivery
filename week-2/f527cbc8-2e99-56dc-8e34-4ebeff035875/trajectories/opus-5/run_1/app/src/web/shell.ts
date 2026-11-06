import { api, type BarnDay, type Me, type Practice } from './api.js';
import { clear, el } from './dom.js';
import { mountNotices } from './notices.js';

/** The app shell: a fixed left rail of barn days, a header strip and the main column. */
export interface ScreenContext {
  me: Me;
  practice: Practice;
  main: HTMLElement;
  /** Pushes a new history entry and renders. */
  navigate: (path: string) => void;
  /** Replaces the current entry without adding one. */
  replace: (path: string) => void;
  refreshRail: () => Promise<void>;
  /** Registers work to run on the screen's periodic refresh. */
  onRefresh: (work: () => Promise<void>, everyMs: number) => void;
  /** Cleared whenever the screen changes. */
  onTeardown: (work: () => void) => void;
  barnDays: () => BarnDay[];
}

export interface Shell {
  main: HTMLElement;
  setRailDays: (days: BarnDay[]) => void;
  setCurrentPath: (path: string) => void;
  days: () => BarnDay[];
}

export function buildShell(
  me: Me,
  navigate: (path: string) => void,
  signOut: () => Promise<void>,
): Shell {
  const main = el('main', { class: 'main' });
  const railList = el('ul');
  const railLinks = el('div');
  const rail = el('aside', { class: 'rail' }, [
    el('nav', { 'aria-label': 'Barn days' }, [railList]),
    railLinks,
  ]);

  const toggle = el('button', {
    type: 'button',
    class: 'rail-toggle',
    'aria-expanded': 'false',
    text: 'Barn days',
  }) as HTMLButtonElement;
  toggle.addEventListener('click', () => {
    const open = rail.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  const signOutButton = el('button', { type: 'button', text: 'Sign out' }) as HTMLButtonElement;
  signOutButton.addEventListener('click', () => void signOut());

  const header = el('header', { class: 'header' }, [
    toggle,
    el('span', { class: 'wordmark', text: 'Rasp & Rein' }),
    el('span', { class: 'spacer' }),
    el('span', { text: me.name }),
    el('span', { class: 'muted', text: roleLabel(me.role) }),
    signOutButton,
  ]);

  const app = el('div', { class: 'app' }, [header, rail, main]);
  clear(document.body);
  document.body.append(app);
  mountNotices(header);

  let days: BarnDay[] = [];
  let currentPath = window.location.pathname;

  const renderRail = (): void => {
    clear(railList);
    for (const day of days) {
      const label = `${day.business_date} ${day.barn.name} ${day.booked_count}/${day.slot_count}`;
      const href = `/days/${day.id}`;
      const link = el('a', { href, text: label });
      if (currentPath === href) link.setAttribute('aria-current', 'page');
      link.addEventListener('click', (event) => {
        event.preventDefault();
        rail.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        navigate(href);
      });
      railList.append(el('li', {}, [link]));
    }

    clear(railLinks);
    const sections: { label: string; href: string }[] = [];
    if (me.role === 'farrier' || me.role === 'owner') {
      sections.push({ label: 'Horses', href: '/horses' });
      sections.push({ label: 'Invoices', href: '/invoices' });
    }
    if (me.role === 'apprentice') sections.push({ label: 'Horses', href: '/horses' });
    if (me.role === 'farrier') {
      sections.push({ label: 'Prices', href: '/prices' });
      sections.push({ label: 'Dashboard', href: '/dashboard' });
    }
    if (sections.length === 0) return;
    const list = el('ul');
    for (const section of sections) {
      const link = el('a', { href: section.href, text: section.label });
      if (currentPath === section.href) link.setAttribute('aria-current', 'page');
      link.addEventListener('click', (event) => {
        event.preventDefault();
        rail.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        navigate(section.href);
      });
      list.append(el('li', {}, [link]));
    }
    railLinks.append(list);
  };

  return {
    main,
    setRailDays: (next) => {
      days = next;
      renderRail();
    },
    setCurrentPath: (path) => {
      currentPath = path;
      renderRail();
    },
    days: () => days,
  };
}

function roleLabel(role: Me['role']): string {
  switch (role) {
    case 'farrier':
      return 'Farrier';
    case 'apprentice':
      return 'Apprentice';
    case 'owner':
      return 'Horse owner';
    case 'barn_manager':
      return 'Barn manager';
  }
}

export async function loadRailDays(): Promise<BarnDay[]> {
  return await api.get<BarnDay[]>('/api/barn-days');
}
