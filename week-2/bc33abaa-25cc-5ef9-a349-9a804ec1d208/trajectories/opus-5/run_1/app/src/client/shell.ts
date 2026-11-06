import { MeDto, SubscriptionDto } from '../shared/api';
import { formatLocalTime } from '../shared/format';
import { ApiCallError, api, onOutage } from './api';
import { el, mount } from './dom';
import { navigate } from './router';

export interface Session {
  me: MeDto;
  memberName: string;
  role: string;
  workspaceName: string;
  timeZone: string;
  subscription: SubscriptionDto;
}

let cached: Session | null = null;

export async function loadSession(force = false): Promise<Session | null> {
  if (cached && !force) return cached;
  try {
    const me = await api.get<MeDto>('/api/me');
    if (!me.member || !me.subscription) return null;
    cached = {
      me,
      memberName: me.member.name,
      role: me.member.role,
      workspaceName: me.workspace.name,
      timeZone: me.workspace.timeZone,
      subscription: me.subscription,
    };
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

export function clearSession(): void {
  cached = null;
}

/** Carries a live-region message across a screen that re-renders itself. */
const flashes = new Map<string, string>();

export function setFlash(region: string, message: string): void {
  flashes.set(region, message);
}

export function takeFlash(region: string): string {
  const message = flashes.get(region) ?? '';
  flashes.delete(region);
  return message;
}

const NAV_BY_ROLE: Record<string, string[]> = {
  owner: ['Dashboard', 'Scenes', 'Members', 'Agents', 'Audit', 'Billing', 'Settings'],
  admin: ['Dashboard', 'Scenes', 'Members', 'Agents', 'Audit'],
  billing_manager: ['Dashboard', 'Scenes', 'Members', 'Billing'],
  editor: ['Dashboard', 'Scenes'],
  viewer: ['Dashboard', 'Scenes'],
};

const NAV_PATHS: Record<string, string> = {
  Dashboard: '/app',
  Scenes: '/app/scenes',
  Members: '/app/members',
  Agents: '/app/agents',
  Audit: '/app/audit',
  Billing: '/app/billing',
  Settings: '/app/settings',
};

interface OutageState {
  fileStorage: boolean;
  billing: boolean;
}

const outage: OutageState = { fileStorage: false, billing: false };
let statusRegion: HTMLElement | null = null;
let statusTimer: number | null = null;

onOutage((failure) => {
  if (failure.service === 'billing') outage.billing = true;
  if (failure.service === 'file_storage') outage.fileStorage = true;
  paintStatus();
});

function statusCopy(session: Session | null): string {
  if (outage.fileStorage) {
    return 'File storage is unavailable. Your edits are saved; uploads, versions and publishing will resume when it is back.';
  }
  if (outage.billing) {
    return 'Billing is unavailable right now. Nothing was charged. Editing and publishing keep working.';
  }
  if (!session) return '';
  const subscription = session.subscription;
  if (subscription.state === 'past_due') {
    const deadline = subscription.graceEndsAt
      ? formatLocalTime(subscription.graceEndsAt, session.timeZone)
      : '';
    return `Payment failed. Pay invoice ${pastDueInvoiceNumber} by ${deadline} to keep publishing.`;
  }
  if (subscription.state === 'suspended') {
    return subscription.trialEndsAt === null
      ? 'This workspace is read-only until the overdue invoice is paid.'
      : 'Your trial has ended. Start a paid plan to keep editing.';
  }
  if (subscription.state === 'cancelled') {
    return 'This subscription is cancelled. The workspace is read-only.';
  }
  return '';
}

let pastDueInvoiceNumber = '';
let currentSession: Session | null = null;

function paintStatus(): void {
  if (!statusRegion) return;
  const copy = statusCopy(currentSession);
  statusRegion.textContent = copy;
  statusRegion.classList.toggle('is-visible', copy.length > 0);
  statusRegion.classList.toggle(
    'is-alert',
    currentSession !== null &&
      ['past_due', 'suspended', 'cancelled'].includes(currentSession.subscription.state) &&
      !outage.fileStorage &&
      !outage.billing,
  );
}

async function refreshStatus(): Promise<void> {
  try {
    const status = await api.get<{ fileStorage: string; billing: string }>('/api/service-status');
    outage.fileStorage = status.fileStorage === 'down';
    outage.billing = status.billing === 'down';
  } catch {
    // Leave the last known state; the next pass tries again.
  }
  const session = await loadSession(true);
  currentSession = session;
  if (session && session.subscription.state === 'past_due') {
    await refreshPastDueInvoice(session);
  }
  paintStatus();
}

async function refreshPastDueInvoice(session: Session): Promise<void> {
  if (!['owner', 'billing_manager'].includes(session.role)) return;
  try {
    const billing = await api.get<{ invoices: { number: string; status: string }[] }>(
      '/api/billing/invoices',
    );
    const unpaid = billing.invoices.find((invoice) => invoice.status === 'unpaid');
    if (unpaid) pastDueInvoiceNumber = unpaid.number;
  } catch {
    // The banner keeps the number it already knows.
  }
}

export function appShell(session: Session, active: string, content: HTMLElement): HTMLElement {
  currentSession = session;
  const links = (NAV_BY_ROLE[session.role] ?? ['Dashboard', 'Scenes']).map((label) =>
    el('li', {}, [
      el('a', {
        href: NAV_PATHS[label] ?? '/app',
        text: label,
        'aria-current': label === active ? 'page' : null,
      }),
    ]),
  );
  const navigation = el('nav', { 'aria-label': 'Workspace', class: 'workspace-nav' }, [
    el('ul', {}, links),
  ]);
  const menuButton = el('button', {
    type: 'button',
    class: 'menu-button',
    'aria-expanded': 'false',
    text: 'Menu',
  });
  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', open ? 'false' : 'true');
    navigation.classList.toggle('is-open', !open);
  });

  const signOut = el('button', { type: 'button', class: 'button quiet', text: 'Sign out' });
  signOut.addEventListener('click', () => {
    void api.post('/api/auth/logout').then(() => {
      clearSession();
      navigate('/login');
    });
  });

  statusRegion = el('div', {
    role: 'status',
    'aria-label': 'Service status',
    class: 'service-status',
  });

  if (statusTimer !== null) window.clearInterval(statusTimer);
  statusTimer = window.setInterval(() => void refreshStatus(), 3_000);
  void refreshStatus();

  return el('div', { class: 'app-shell' }, [
    el('header', { class: 'top-bar' }, [
      el('div', { class: 'top-bar-identity' }, [
        el('a', { href: '/app', class: 'wordmark', text: 'Orrery Studio' }),
        el('span', { class: 'workspace-name', text: session.workspaceName }),
      ]),
      menuButton,
      navigation,
      el('div', { class: 'top-bar-person' }, [
        el('span', { class: 'person-name', text: session.memberName }),
        signOut,
      ]),
    ]),
    statusRegion,
    el('main', { class: 'app-main' }, [content]),
  ]);
}

export async function renderAppScreen(
  root: HTMLElement,
  active: string,
  build: (session: Session) => HTMLElement | Promise<HTMLElement>,
): Promise<void> {
  const session = await loadSession(true);
  if (!session) {
    navigate('/login');
    return;
  }
  let content: HTMLElement;
  try {
    content = await build(session);
  } catch (error) {
    const denied = error instanceof ApiCallError && (error.status === 403 || error.status === 404);
    content = el('div', { class: 'screen' }, [
      el('h1', { text: denied ? 'Not available' : 'Something went wrong' }),
      el('p', {
        role: 'status',
        text: denied
          ? 'Your role does not have access to this screen.'
          : 'The screen could not be loaded. Try again.',
      }),
    ]);
  }
  mount(root, appShell(session, active, content));
}
