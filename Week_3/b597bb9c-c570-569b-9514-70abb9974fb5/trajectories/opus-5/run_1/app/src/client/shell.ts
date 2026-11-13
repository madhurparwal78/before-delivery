/** The band, the Notices strip and the signed-in state every page shares. */
import { get, remove } from './api.js';
import { clear, el, find } from './dom.js';
import type { AllowanceRecord, Person, ProjectRecord, ServiceStatus } from '../shared/types.js';

export interface SessionState {
  person: Person;
  is_owner: boolean;
}

export interface Shared {
  session: SessionState | null;
  allowance: AllowanceRecord | null;
  status: (ServiceStatus & { waiting?: number }) | null;
  projects: ProjectRecord[];
  availability: string;
}

export const shared: Shared = {
  session: null,
  allowance: null,
  status: null,
  projects: [],
  availability: '',
};

export async function loadSession(): Promise<SessionState | null> {
  try {
    const session = await get<SessionState>('/api/session');
    shared.session = session;
    return session;
  } catch {
    shared.session = null;
    return null;
  }
}

export async function loadAllowance(): Promise<void> {
  try {
    shared.allowance = await get<AllowanceRecord>('/api/allowance');
  } catch {
    shared.allowance = null;
  }
}

export async function loadStatus(): Promise<void> {
  if (shared.session?.is_owner !== true) {
    shared.status = null;
    return;
  }
  try {
    shared.status = await get<ServiceStatus & { waiting: number }>('/api/status');
  } catch {
    shared.status = null;
  }
}

export function allowanceText(): string {
  return shared.allowance?.text ?? '';
}

export function setAllowance(record: AllowanceRecord): void {
  shared.allowance = record;
  for (const node of document.querySelectorAll('[data-allowance]')) node.textContent = record.text;
}

export interface BandOptions {
  /** the lead line of the band, one type step larger */
  brand?: string;
  columns?: (Node | null)[];
  showLibrary?: boolean;
}

export function bandLinks(): HTMLElement {
  const owner = shared.session?.is_owner === true;
  const canLibrary = owner || shared.projects.some((project) => project.role === 'editor');
  const links = el('nav', { class: 'band-links', 'aria-label': 'Gatecut' }, [
    el('a', { href: '/', class: 'band-link', text: 'Projects' }),
    canLibrary ? el('a', { href: '/library', class: 'band-link', text: 'Library' }) : null,
    el('a', { href: '/profile', class: 'band-link', text: 'Profile' }),
    el('button', { type: 'button', class: 'band-link', 'data-sign-out': '', text: 'Sign out' }),
  ]);
  const signOut = find<HTMLButtonElement>('[data-sign-out]', links);
  signOut?.addEventListener('click', () => {
    void remove('/api/session').then(() => {
      window.location.assign('/sign-in');
    });
  });
  return links;
}

export function band(options: BandOptions = {}): HTMLElement {
  return el('header', { class: 'band' }, [
    el('div', { class: 'band-grid' }, [
      el('p', { class: 'brand', text: options.brand ?? 'Gatecut' }),
      ...(options.columns ?? []),
      shared.session === null ? null : bandLinks(),
    ]),
    shared.session === null ? null : el('p', { class: 'band-allowance', 'data-allowance': '', text: allowanceText() }),
  ]);
}

let currentNotice = '';

export function noticesStrip(): HTMLElement {
  return el('div', { class: 'notices', role: 'status', 'aria-live': 'polite', 'aria-label': 'Notices' }, [
    el('p', { class: 'notice-line', 'data-notice': '', text: currentNotice }),
    el('div', { class: 'outage-lines', 'data-outages': '' }),
  ]);
}

/** The strip keeps its last line through a redraw. */
export function notice(text: string): void {
  currentNotice = text;
  const line = find<HTMLElement>('[data-notice]');
  if (line !== null) line.textContent = text;
}

/** The owner's outage banners stay until a later action of theirs succeeds. */
export function renderOutages(): void {
  const host = find<HTMLElement>('[data-outages]');
  if (host === null) return;
  clear(host);
  const status = shared.status;
  if (status === null || shared.session?.is_owner !== true) return;
  if (status.storage === 'down') {
    host.append(
      el('p', {
        class: 'outage',
        'data-outage': 'storage',
        text: 'Media storage is unreachable. Uploads and exports are paused; nothing was saved.',
      }),
    );
  }
  if (status.queue === 'down') {
    host.append(
      el('p', {
        class: 'outage',
        'data-outage': 'queue',
        text: 'The export queue is unreachable. No export was started and no minutes were used.',
      }),
    );
  }
  if (status.mail === 'down' || (status.waiting ?? 0) > 0) {
    host.append(
      el('p', {
        class: 'outage',
        'data-outage': 'mail',
        text: `Mail is waiting in the outbox: ${status.waiting ?? 0} messages.`,
      }),
    );
  }
}

export function activityRegion(): HTMLElement {
  return el('div', {
    class: 'visually-hidden',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Project activity',
    'data-activity': '',
  });
}

export function announce(text: string): void {
  const region = find<HTMLElement>('[data-activity]');
  if (region === null) return;
  region.append(el('p', { text }));
}

export function mount(...nodes: (Node | null)[]): HTMLElement {
  const app = find<HTMLElement>('#app');
  if (app === null) throw new Error('the page shell is missing');
  clear(app);
  for (const node of nodes) if (node !== null) app.append(node);
  return app;
}
