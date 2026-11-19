import type { Principal, Role } from '../shared/types.js';
import { getJson } from './api.js';
import { el } from './dom.js';
import { quenbyMark } from './marks.js';

export interface AppConfig {
  today: string;
  now: string;
  timeZone: string;
  weightAnnounceDelayMs: number;
}

export interface Session {
  principal: Principal | null;
  config: AppConfig;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let session: Session = {
  principal: null,
  config: { today: '2026-03-02', now: '2026-03-02T08:00:00.000Z', timeZone: 'Europe/Berlin', weightAnnounceDelayMs: 300 },
};

export function readEmbeddedConfig(): void {
  const node = document.getElementById('app-config');
  if (!node || !node.textContent) return;
  const parsed = JSON.parse(node.textContent) as Partial<AppConfig>;
  session = { ...session, config: { ...session.config, ...parsed } };
}

export async function loadSession(): Promise<Session> {
  try {
    const me = await getJson<{ principal: Principal } & AppConfig>('/api/me');
    session = {
      principal: me.principal,
      config: {
        today: me.today,
        now: me.now,
        timeZone: me.timeZone,
        weightAnnounceDelayMs: me.weightAnnounceDelayMs,
      },
    };
  } catch {
    session = { ...session, principal: null };
  }
  return session;
}

export function currentSession(): Session {
  return session;
}

export function setPrincipal(principal: Principal | null): void {
  session = { ...session, principal };
}

function parts(value: string | Date): Intl.DateTimeFormatPart[] {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: session.config.timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
}

function read(found: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return found.find((part) => part.type === type)?.value ?? '';
}

/** `D MMM YYYY`, from an ISO instant or a calendar date. */
export function displayDate(value: string | Date | null): string {
  if (value === null) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
  }
  const found = parts(value);
  return `${Number(read(found, 'day'))} ${MONTHS[Number(read(found, 'month')) - 1]} ${read(found, 'year')}`;
}

/** `HH:mm`. */
export function displayTime(value: string | Date): string {
  const found = parts(value);
  return `${read(found, 'hour')}:${read(found, 'minute')}`;
}

export function displayDateTime(value: string | Date): string {
  return `${displayDate(value)} ${displayTime(value)}`;
}

const NAV_LINKS: { label: string; href: string; roles: Role[] }[] = [
  { label: 'Library', href: '/library', roles: ['owner', 'brand_reviewer', 'legal_reviewer', 'author', 'agency', 'employee', 'press'] },
  { label: 'My requests', href: '/requests', roles: ['agency'] },
  { label: 'Queue', href: '/queue', roles: ['owner', 'brand_reviewer', 'legal_reviewer'] },
  { label: 'Editor', href: '/editor/logo', roles: ['owner', 'brand_reviewer', 'author'] },
  { label: 'Admin', href: '/admin/assets', roles: ['owner'] },
  { label: 'Admin', href: '/admin/grants', roles: ['legal_reviewer'] },
];

let statusRegion: HTMLElement | null = null;

export function pageStatusRegion(): HTMLElement {
  if (!statusRegion) {
    statusRegion = el('p', { class: 'page-status', role: 'status', 'aria-live': 'polite', 'aria-label': 'Page status' });
  }
  return statusRegion;
}

export function setPageStatus(text: string): void {
  pageStatusRegion().textContent = text;
}

export function topBar(onNavigate: (href: string) => void, onSignOut: () => void): HTMLElement {
  const role = session.principal?.role;
  const links = NAV_LINKS.filter((link) => role !== undefined && link.roles.includes(role));
  return el(
    'header',
    { class: 'top-bar' },
    quenbyMark(34, '#1F4E8C'),
    el(
      'nav',
      { 'aria-label': 'Main' },
      ...links.map((link) =>
        el(
          'a',
          {
            href: link.href,
            onclick: (event: Event) => {
              event.preventDefault();
              onNavigate(link.href);
            },
          },
          link.label,
        ),
      ),
    ),
    el('button', { type: 'button', class: 'pill', onclick: onSignOut }, 'Sign out'),
  );
}
