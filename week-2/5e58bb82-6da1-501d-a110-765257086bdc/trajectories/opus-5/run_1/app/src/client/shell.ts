import {
  IDLE_SIGN_OUT_COPY,
  MAIL_BANNER,
  STORAGE_BACK,
  STORAGE_BANNER,
} from '../shared/copy.js';
import type { StatusReport, Units, User } from '../shared/types.js';
import { newGeneration, request } from './api.js';
import { button, clear, el, setAttr, setText, trapFocus } from './dom.js';

export type RegionName =
  | 'Service status'
  | 'Session status'
  | 'Fleet announcements'
  | 'Sign-in status'
  | 'Plan preview'
  | 'Form status'
  | 'Plan status'
  | 'Launch status'
  | 'Survey list'
  | 'History status'
  | 'Flags status'
  | 'Comment length';

const IDLE_MS = 28 * 60 * 1000;
const COUNTDOWN_SECONDS = 120;
const STATUS_POLL_MS = 4000;

export interface Shell {
  readonly root: HTMLElement;
  readonly screen: HTMLElement;
  user: User | null;
  units: Units;
  generation: number;
  announce(region: RegionName, text: string): void;
  clearRegion(region: RegionName): void;
  registerRegion(region: RegionName, node: HTMLElement): void;
  unregisterRegion(region: RegionName): void;
  status(): StatusReport;
  onStatus(listener: (status: StatusReport) => void): () => void;
  navigate(path: string, options?: { replace?: boolean }): void;
  signOut(options?: { next?: string; reason?: string }): Promise<void>;
  openDialogs: Set<HTMLElement>;
  /** Replaces the mounted screen with the not-found page. */
  notFound(): void;
  reset(): void;
}

export interface ShellHooks {
  render(path: string): void;
  signInReason(reason: string | null): void;
  notFound(): void;
}

export function createShell(root: HTMLElement, hooks: ShellHooks): Shell {
  const regions = new Map<RegionName, HTMLElement>();
  const screen = el('main', { id: 'screen' });
  let user: User | null = null;
  let units: Units = 'metric';
  let generation = newGeneration();
  let statusReport: StatusReport = { storage: 'up', mail: 'up' };
  let lastStorage: 'up' | 'down' | null = null;
  let lastMail: 'up' | 'down' | null = null;
  let storageBackTimer: number | null = null;
  const statusListeners = new Set<(status: StatusReport) => void>();

  const topBar = el('header', { class: 'topbar' });
  const serviceStatus = region('Service status');
  const sessionStatus = region('Session status');
  root.append(topBar, serviceStatus, sessionStatus, screen);

  function region(name: RegionName): HTMLElement {
    const node = el('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-label': name,
      class: 'live-region',
    });
    regions.set(name, node);
    return node;
  }

  const shell: Shell = {
    root,
    screen,
    get user() {
      return user;
    },
    set user(value) {
      user = value;
      if (value) units = value.units;
      renderTopBar();
    },
    get units() {
      return units;
    },
    set units(value) {
      units = value;
      renderTopBar();
    },
    get generation() {
      return generation;
    },
    set generation(value) {
      generation = value;
    },
    announce(name, text) {
      const node = regions.get(name);
      if (node) setText(node, text);
    },
    clearRegion(name) {
      const node = regions.get(name);
      if (node) setText(node, '');
    },
    registerRegion(name, node) {
      regions.set(name, node);
    },
    unregisterRegion(name) {
      if (name !== 'Service status' && name !== 'Session status') regions.delete(name);
    },
    status: () => statusReport,
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    navigate(path, options = {}) {
      if (options.replace) window.history.replaceState(null, '', path);
      else window.history.pushState(null, '', path);
      hooks.render(path);
    },
    async signOut(options = {}) {
      await request('/api/session', { method: 'DELETE' }).catch(() => undefined);
      const target = options.next
        ? `/sign-in?next=${encodeURIComponent(options.next)}`
        : '/sign-in';
      shell.reset();
      hooks.signInReason(options.reason ?? null);
      window.history.pushState(null, '', target);
      hooks.render(target);
    },
    openDialogs: new Set<HTMLElement>(),
    notFound() {
      hooks.notFound();
    },
    reset() {
      generation = newGeneration();
      user = null;
      units = 'metric';
      statusReport = { storage: 'up', mail: 'up' };
      lastStorage = null;
      lastMail = null;
      for (const dialog of shell.openDialogs) dialog.remove();
      shell.openDialogs.clear();
      for (const node of regions.values()) setText(node, '');
      clear(screen);
      renderTopBar();
    },
  };

  function renderTopBar(): void {
    clear(topBar);
    if (!user) {
      topBar.hidden = true;
      return;
    }
    topBar.hidden = false;
    const links: [string, string][] =
      user.role === 'principal_surveyor'
        ? [
            ['Fleet', '/fleet'],
            ['Missions', '/missions'],
            ['New mission', '/missions/new'],
          ]
        : user.role === 'launch_technician'
          ? [
              ['Fleet', '/fleet'],
              ['Missions', '/missions'],
              ['Launch list', '/launch'],
            ]
          : [['Surveys', '/surveys']];

    const nav = el('nav', { 'aria-label': 'Main', class: 'mainnav' });
    for (const [label, href] of links) {
      const link = el('a', { href, class: 'navlink' }, [label]);
      link.addEventListener('click', (event) => {
        event.preventDefault();
        shell.navigate(href);
      });
      nav.append(link);
    }

    const unitsGroup = el('div', { role: 'radiogroup', 'aria-label': 'Units', class: 'units' });
    for (const choice of ['Metric', 'Imperial'] as const) {
      const value: Units = choice === 'Metric' ? 'metric' : 'imperial';
      const input = el('input', {
        type: 'radio',
        name: 'units',
        id: `units-${value}`,
        checked: units === value,
      });
      input.addEventListener('change', () => {
        void changeUnits(value);
      });
      unitsGroup.append(
        el('span', { class: 'unitchoice' }, [input, el('label', { for: `units-${value}` }, [choice])]),
      );
    }

    const signOut = button('Sign out', { class: 'signout' });
    signOut.addEventListener('click', () => {
      void shell.signOut();
    });

    topBar.append(
      el('span', { class: 'brand' }, ['Swathdeck']),
      nav,
      unitsGroup,
      signOut,
    );
  }

  async function changeUnits(value: Units): Promise<void> {
    const at = generation;
    const updated = await request<User>('/api/me', { method: 'PATCH', body: { units: value } });
    if (at !== generation) return;
    shell.user = updated;
    hooks.render(`${window.location.pathname}${window.location.search}`);
  }

  function applyStatus(next: StatusReport): void {
    statusReport = next;
    if (lastStorage !== next.storage) {
      if (next.storage === 'down') {
        shell.announce('Service status', STORAGE_BANNER);
        if (storageBackTimer !== null) window.clearTimeout(storageBackTimer);
      } else if (lastStorage === 'down') {
        shell.announce('Service status', STORAGE_BACK);
        storageBackTimer = window.setTimeout(() => {
          if (statusReport.storage === 'up') shell.clearRegion('Service status');
        }, 10_000);
      }
      lastStorage = next.storage;
    }
    if (lastMail !== next.mail && user && user.role !== 'client_reviewer') {
      if (next.mail === 'down' && next.storage === 'up') {
        shell.announce('Service status', MAIL_BANNER);
      } else if (lastMail === 'down' && next.mail === 'up' && next.storage === 'up') {
        shell.clearRegion('Service status');
      }
      lastMail = next.mail;
    }
    for (const listener of statusListeners) listener(next);
  }

  window.setInterval(() => {
    if (!user) return;
    const at = generation;
    void request<StatusReport>('/api/status')
      .then((next) => {
        if (at === generation && user) applyStatus(next);
      })
      .catch(() => undefined);
  }, STATUS_POLL_MS);

  startIdleWatch(shell);
  renderTopBar();
  return shell;
}

/**
 * After 28 minutes without input, a countdown dialog warns for two minutes and
 * then signs out. Both run on the browser clock and only decide when to sign out.
 */
function startIdleWatch(shell: Shell): void {
  let idleTimer: number | null = null;
  let countdown: number | null = null;
  let dialog: HTMLElement | null = null;
  let remaining = COUNTDOWN_SECONDS;
  let restoreFocus: HTMLElement | null = null;

  const format = (seconds: number): string =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  function close(): void {
    if (countdown !== null) window.clearInterval(countdown);
    countdown = null;
    if (dialog) {
      shell.openDialogs.delete(dialog);
      dialog.remove();
      dialog = null;
    }
    if (restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
    restoreFocus = null;
  }

  function staySignedIn(): void {
    void request('/api/session/refresh', { method: 'POST', body: {} }).catch(() => undefined);
    close();
    shell.clearRegion('Session status');
    arm();
  }

  function tick(): void {
    remaining -= 1;
    if (dialog) {
      const text = dialog.querySelector('[data-countdown]');
      if (text) setText(text, `You will be signed out in ${format(Math.max(0, remaining))} to protect this console.`);
    }
    if (remaining === 60 || remaining === 10) {
      shell.announce(
        'Session status',
        `You will be signed out in ${format(remaining)} to protect this console.`,
      );
    }
    if (remaining <= 0) {
      close();
      const here = `${window.location.pathname}${window.location.search}`;
      void shell.signOut({ next: here, reason: IDLE_SIGN_OUT_COPY });
    }
  }

  function warn(): void {
    if (!shell.user || dialog) return;
    remaining = COUNTDOWN_SECONDS;
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const stay = button('Stay signed in');
    stay.addEventListener('click', staySignedIn);
    const text = el('p', { 'data-countdown': '' }, [
      `You will be signed out in ${format(COUNTDOWN_SECONDS)} to protect this console.`,
    ]);
    dialog = el(
      'div',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Session ending', class: 'dialog' },
      [el('div', { class: 'dialog-card' }, [el('h2', {}, ['Session ending']), text, stay])],
    );
    dialog.addEventListener('keydown', (event) => {
      trapFocus(dialog!, event);
      if (event.key === 'Escape') {
        event.preventDefault();
        staySignedIn();
      }
    });
    shell.openDialogs.add(dialog);
    shell.root.append(dialog);
    stay.focus();
    shell.announce(
      'Session status',
      `You will be signed out in ${format(COUNTDOWN_SECONDS)} to protect this console.`,
    );
    countdown = window.setInterval(tick, 1000);
  }

  function arm(): void {
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(warn, IDLE_MS);
  }

  for (const event of ['pointerdown', 'keydown', 'touchstart', 'pointermove'] as const) {
    window.addEventListener(
      event,
      () => {
        if (dialog) return;
        arm();
      },
      { passive: true },
    );
  }
  arm();
}

export { setAttr };
