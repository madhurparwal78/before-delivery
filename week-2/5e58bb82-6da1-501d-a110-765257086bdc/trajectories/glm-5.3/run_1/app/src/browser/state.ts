import { User, Units, Mission, Vessel, Alert } from './app.js';
import { apiFetch, getMe, getStatus, StatusBody, putLastScreen } from './api.js';
import { byId, setStatusText, debounce } from './dom.js';

export interface Store {
  user: User | null;
  units: Units;
  status: StatusBody;
  vessels: Vessel[];
  alerts: Alert[];
  missions: Mission[];
  // announcements
  lastAnnouncedLink: Record<string, string>;
  loadedOnce: boolean;
  dataSignature: string;
}

export const store: Store = {
  user: null,
  units: 'metric',
  status: { storage: 'up', mail: 'up' },
  vessels: [],
  alerts: [],
  missions: [],
  lastAnnouncedLink: {},
  loadedOnce: false,
  dataSignature: '',
}

export interface RefreshHooks {
  onVessels?: (vessels: Vessel[]) => void;
  onAlerts?: (alerts: Alert[]) => void;
  onMissions?: (missions: Mission[]) => void;
  onStatus?: (status: StatusBody) => void;
}

let hooks: RefreshHooks = {};
export function setHooks(rh: RefreshHooks): void { hooks = rh; }

export function announce(text: string): void {
  const el = byId('fleet-announcements');
  if (el) setStatusText(el, text);
}

// ---------- storage & mail banners ----------

let lastStorage: 'up' | 'down' | null = null;
let lastMail: 'up' | 'down' | null = null;
let storageReturnTimer: ReturnType<typeof setTimeout> | null = null;

export function refreshStatusBanner(status: StatusBody): void {
  const el = byId('service-status');
  if (!el || !store.user) return;
  store.status = status;
  const texts: string[] = [];
  if (status.storage === 'down') {
    texts.push('Line-file storage is unreachable — uploads are paused and will resume on their own.');
  } else if (lastStorage === 'down' && status.storage === 'up') {
    texts.push('Line-file storage is back');
    if (storageReturnTimer) clearTimeout(storageReturnTimer);
    storageReturnTimer = setTimeout(() => {
      const e2 = byId('service-status');
      if (e2 && e2.textContent === 'Line-file storage is back') e2.textContent = '';
    }, 10000);
  }
  if (store.user.role !== 'client_reviewer') {
    if (status.mail === 'down') {
      texts.push('Alert email is delayed — alerts still show on this board.');
    }
  }
  const text = texts.join(' ');
  if (el.textContent !== text) el.textContent = text;
  lastStorage = status.storage;
  lastMail = status.mail;
}

// ---------- session & idle sign-out ----------

const IDLE_MS = 28 * 60 * 1000;
const WARN_MS = 2 * 60 * 1000;

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let idleWarnTimer: ReturnType<typeof setTimeout> | null = null;
let warnDeadline: number | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let idleDialogEl: HTMLElement | null = null;
let lastFocused: HTMLElement | null = null;

export function resetIdle(): void {
  if (warnDeadline !== null) return; // countdown owns the show until resolved
  if (idleTimer) clearTimeout(idleTimer);
  if (idleWarnTimer) clearTimeout(idleWarnTimer);
  if (!store.user) return;
  idleWarnTimer = setTimeout(startIdleWarning, IDLE_MS);
}

function startIdleWarning(): void {
  warnDeadline = Date.now() + WARN_MS;
  lastFocused = document.activeElement as HTMLElement | null;
  const statusEl = byId('session-status');
  openIdleDialog();
  if (countdownTimer) clearInterval(countdownTimer);
  let lastStatusText = '';
  countdownTimer = setInterval(() => {
    const remain = Math.max(0, warnDeadline! - Date.now());
    const mm = Math.floor(remain / 60000);
    const ss = Math.floor((remain % 60000) / 1000);
    const clock = `${mm}:${String(ss).padStart(2, '0')}`;
    const txt = byId('session-ending-clock');
    if (txt) txt.textContent = `You will be signed out in ${clock} to protect this console.`;
    const wantStatus = remain === WARN_MS || clock === '1:00' || clock === '0:10'
      ? `You will be signed out in ${clock} to protect this console.` : null;
    if (wantStatus && statusEl && statusEl.textContent !== wantStatus) statusEl.textContent = wantStatus;
    void lastStatusText;
    if (remain === 0) {
      finishIdleSignOut();
    }
  }, 1000);
}

function openIdleDialog(): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  const root = document.createElement('div');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Session ending');
  root.className = 'dialog';
  const clock = document.createElement('p');
  clock.id = 'session-ending-clock';
  clock.textContent = 'You will be signed out in 2:00 to protect this console.';
  const stay = document.createElement('button');
  stay.textContent = 'Stay signed in';
  stay.addEventListener('click', staySignedIn);
  root.append(clock, stay);
  backdrop.append(root);
  document.body.append(backdrop);
  idleDialogEl = root;
  setTimeout(() => stay.focus(), 0);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      staySignedIn();
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  };
  document.addEventListener('keydown', onKey, true);
  function staySignedIn(): void {
    void staySignedInInner();
  }
  async function staySignedInInner(): Promise<void> {
    document.removeEventListener('keydown', onKey, true);
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
    warnDeadline = null;
    if (backdrop.parentNode) document.body.removeChild(backdrop);
    idleDialogEl = null;
    const statusEl = byId('session-status');
    if (statusEl) statusEl.textContent = '';
    await apiFetch<void>('POST', '/api/session/refresh', {});
    resetIdle();
    lastFocused?.focus();
  }
  (idleDialogEl as unknown as { _stay: () => void })._stay = staySignedIn;
}

function finishIdleSignOut(): void {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
  warnDeadline = null;
  window.location.href = `/sign-in?next=${encodeURIComponent(location.pathname + location.search)}&idle=1`;
}

export function cancelIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  if (idleWarnTimer) clearTimeout(idleWarnTimer);
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
  warnDeadline = null;
}

// ---------- polling ----------

let pollTimer: ReturnType<typeof setInterval> | null = null;
let fastPoll = false;

export async function refreshCommon(): Promise<void> {
  if (!store.user) return;
  const isStaff = store.user.role !== 'client_reviewer';
  try {
    const [status, missions] = await Promise.all([
      getStatus(),
      apiFetch<Mission[]>('GET', '/api/missions'),
    ]);
    refreshStatusBanner(status);
    if (JSON.stringify(store.missions) !== JSON.stringify(missions)) {
      store.missions = missions;
      hooks.onMissions?.(missions);
    }
    if (isStaff) {
      const [vessels, alerts] = await Promise.all([
        apiFetch<Vessel[]>('GET', '/api/vessels'),
        apiFetch<Alert[]>('GET', '/api/alerts?status=open'),
      ]);
      if (JSON.stringify(store.vessels) !== JSON.stringify(vessels)) {
        announceLinkChanges(store.vessels, vessels);
        store.vessels = vessels;
        hooks.onVessels?.(vessels);
      } else {
        // link state can change purely by time passing; recompute announcements
        hooks.onVessels?.(vessels);
      }
      if (JSON.stringify(store.alerts) !== JSON.stringify(alerts)) {
        store.alerts = alerts;
        announceAlertsOnce(alerts);
        hooks.onAlerts?.(alerts);
      } else {
        announceAlertsOnce(alerts);
      }
    }
    store.dataSignature = JSON.stringify([store.missions, store.vessels, store.alerts]);
    store.loadedOnce = true;
  } catch {
    // offline: keep the last state; the next poll retries
  }
}

function announceLinkChanges(oldVessels: Vessel[], newVessels: Vessel[]): void {
  if (!store.loadedOnce) return;
  const byIdMap = new Map(oldVessels.map(v => [v.id, v]));
  for (const v of newVessels) {
    const before = byIdMap.get(v.id);
    if (!before) continue;
    if (before.link_state !== v.link_state) {
      const word = v.link_state === 'Live' ? 'live' : v.link_state === 'Stale' ? 'stale' : 'lost';
      announce(`${v.name} link ${word}`);
    }
  }
}

// Each alert is announced once per page session, whenever the board first sees it.
const announcedAlerts = new Set<string>();

function announceAlertsOnce(alerts: Alert[]): void {
  for (const a of alerts) {
    if (a.state === 'Closed') continue;
    const raisedKey = `${a.id}:raised`;
    if (!announcedAlerts.has(raisedKey)) {
      announcedAlerts.add(raisedKey);
      announce(a.heading);
      continue;
    }
    const rectKey = `${a.id}:rectified`;
    if (a.state === 'Rectified' && !announcedAlerts.has(rectKey)) {
      announcedAlerts.add(rectKey);
      announce(`${a.heading} — rectified`);
    }
  }
}

export function startPolling(): void {
  stopPolling();
  const period = fastPoll ? 2000 : 2000;
  pollTimer = setInterval(() => { void refreshCommon(); }, period);
  void refreshCommon();
}

export function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// ---------- auth ----------

export async function loadUser(): Promise<User | null> {
  try {
    const me = await getMe();
    store.user = me;
    store.units = me.units;
    return me;
  } catch {
    store.user = null;
    return null;
  }
}

export function signOutBrowser(): void {
  announcedAlerts.clear();
  store.user = null;
  store.vessels = [];
  store.alerts = [];
  store.missions = [];
  store.loadedOnce = false;
  store.lastAnnouncedLink = {};
  for (const id of ['fleet-announcements', 'service-status', 'session-status', 'launch-status', 'plan-status', 'plan-preview', 'form-status', 'survey-list', 'history-status', 'flags-status']) {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  }
}

export async function signOut(): Promise<void> {
  await apiFetch<void>('DELETE', '/api/session').catch(() => undefined);
  cancelIdle();
  signOutBrowser();
  window.location.href = '/sign-in';
}

export async function initUserSession(): Promise<void> {
  await loadUser();
  resetIdle();
  startPolling();
  ['pointerdown', 'keydown', 'touchstart'].forEach(evt => {
    window.addEventListener(evt, () => resetIdle(), { passive: true });
  });
}

const recordLastScreenDebounced = debounce((path: string) => {
  void putLastScreen(path);
}, 400);

export function recordScreen(path: string): void {
  if (!store.user) return;
  recordLastScreenDebounced(path);
}

export async function setUnitsForUser(units: Units): Promise<void> {
  store.units = units;
  await apiFetch<void>('PATCH', '/api/me', { units }).catch(() => undefined);
  window.dispatchEvent(new CustomEvent('swathdeck:rerender'));
}
