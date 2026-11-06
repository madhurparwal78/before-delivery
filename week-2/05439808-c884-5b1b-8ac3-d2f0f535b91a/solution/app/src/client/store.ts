// App state, the live regions, routing, the session lifecycle and the live channel.
import { BUILDINGS } from '../shared/catalog';
import { api, ApiFailure, configureApi, setCsrf } from './api';
import { OUTAGE, SESSION_ENDED, SIGNED_OUT } from './copy';
import type { ClanBundle, Invitation, Me, Message as ChatMessage, RaidRow, Rewards, UnitRequest, Village } from './types';

export type Panel =
  | { kind: 'details'; id: number; focus: boolean }
  | { kind: 'train' }
  | { kind: 'scout' }
  | { kind: 'raid-result' }
  | { kind: 'raid-log' }
  | { kind: 'rewards' }
  | { kind: 'clan' }
  | { kind: 'league' }
  | { kind: 'profile' };

type Dialog = { kind: 'build' } | { kind: 'donate'; request: UnitRequest; opener: HTMLElement | null };

interface Message {
  text: string;
  key: number;
  tone: 'plain' | 'danger' | 'under-attack';
}

export type RaidLists = { attack: RaidRow[]; defence: RaidRow[] };

interface State {
  booted: boolean;
  path: string;
  search: string;
  me: Me | null;
  village: Village | null;
  rewards: Rewards | null;
  raids: RaidLists | null;
  clan: ClanBundle | null;
  panel: Panel | null;
  dialog: Dialog | null;
  offset: number;
  notice: Message | null;
  alert: Message | null;
  outage: boolean;
  unread: number;
  chatVisible: boolean;
  removedFrom: string | null;
}

export const state: State = {
  booted: false,
  path: location.pathname,
  search: location.search,
  me: null,
  village: null,
  rewards: null,
  raids: null,
  clan: null,
  panel: null,
  dialog: null,
  offset: 0,
  notice: null,
  alert: null,
  outage: false,
  unread: 0,
  chatVisible: false,
  removedFrom: null,
};

const listeners = new Set<() => void>();
export const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function update(patch: Partial<State>): void {
  Object.assign(state, patch);
  for (const fn of listeners) fn();
}

let messageKey = 0;

/** Tide notices (polite): pending, success and notice copy. Each message replaces the last. */
export function notify(text: string, tone: Message['tone'] = 'plain'): void {
  update({ notice: { text, key: (messageKey += 1), tone } });
}

/** Tide alerts (assertive): error, outage and session copy. */
export function warn(text: string): void {
  update({ alert: { text, key: (messageKey += 1), tone: 'danger' } });
}

function clearAlert(): void {
  if (state.alert) update({ alert: null });
}

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function serverNow(): number {
  return Date.now() + state.offset;
}

function syncClock(serverTime: string | undefined): void {
  if (serverTime) state.offset = Date.parse(serverTime) - Date.now();
}

export function openPanel(panel: Panel | null): void {
  update({ panel });
}

// Routing ---------------------------------------------------------------------------------------

export function navigate(to: string, replace = false): void {
  const url = new URL(to, location.origin);
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  update({ path: url.pathname, search: url.search, dialog: null });
}

export function query(name: string): string | null {
  return new URLSearchParams(state.search).get(name);
}

window.addEventListener('popstate', () => update({ path: location.pathname, search: location.search, dialog: null }));

// Session ---------------------------------------------------------------------------------------

const SIGNED_OUT_KEY = 'saltreach.signed-out';
let leaving = false;

/** True after this tab's own sign-out, until the next sign-in. */
export function signedOutHere(): boolean {
  return sessionStorage.getItem(SIGNED_OUT_KEY) === '1';
}

async function refreshSession(): Promise<Me | null> {
  const s = await api.get<{ user: Me | null; csrfToken: string }>('/api/session', { quietUnauthenticated: true });
  setCsrf(s.csrfToken);
  return s.user;
}

export async function boot(): Promise<void> {
  try {
    const me = await refreshSession();
    if (me) await signedIn(me);
  } catch {
    if (state.outage) warn(OUTAGE);
  }
  update({ booted: true });
}

export async function signIn(email: string, password: string): Promise<Me> {
  const r = await api.post<{ user: Me; csrfToken: string }>('/api/auth/signin', { email, password });
  setCsrf(r.csrfToken);
  clearAlert();
  await signedIn(r.user);
  return r.user;
}

async function signedIn(me: Me): Promise<void> {
  sessionStorage.removeItem(SIGNED_OUT_KEY);
  update({ me, village: null, rewards: null, raids: null, clan: null, panel: null, dialog: null, unread: 0, removedFrom: null });
  connectLive();
  if (me.role !== 'operator') await loadVillage().catch(() => undefined);
}

export async function signOut(): Promise<void> {
  leaving = true;
  try {
    await api.post('/api/auth/signout');
  } finally {
    leaving = false;
  }
  sessionStorage.setItem(SIGNED_OUT_KEY, '1');
  forgetSession();
  await refreshSession().catch(() => undefined);
  navigate('/signin');
  notify(SIGNED_OUT);
}

function forgetSession(): void {
  disconnectLive();
  update({ me: null, village: null, rewards: null, raids: null, clan: null, panel: null, dialog: null, unread: 0 });
}

/** Ended by a reset, another tab or the lifetime: tell every open screen and go to sign-in. */
function sessionEnded(): void {
  if (!state.me || leaving) return;
  forgetSession();
  warn(SESSION_ENDED);
  navigate('/signin', true);
  void refreshSession().catch(() => undefined);
}

/** A page restored from the back-forward cache re-checks its session before showing anything. */
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  void refreshSession()
    .then((me) => {
      if (me) return;
      if (signedOutHere()) {
        forgetSession();
        navigate('/signin', true);
        notify(SIGNED_OUT);
      } else sessionEnded();
    })
    .catch(() => undefined);
});

configureApi({
  unauthenticated: sessionEnded,
  outage: (down) => {
    if (down !== state.outage) update({ outage: down });
  },
});

// Reads and the live channel ----------------------------------------------------------------------

export async function loadVillage(): Promise<void> {
  applyVillage(await api.get<Village>('/api/village'));
}

/** Every village update passes here, so job completions and attacks are announced once per tab. */
function applyVillage(next: Village): void {
  const prev = state.village;
  syncClock(next.serverTime);
  if (prev && prev.id === next.id) {
    for (const b of next.buildings) {
      const before = prev.buildings.find((p) => p.id === b.id);
      if (before?.upgrade && !b.upgrade && b.level === before.upgrade.toLevel) notify(`${BUILDINGS[b.type].name} reached level ${b.level}.`);
    }
    if (!prev.underAttack && next.underAttack) notify('Your island is under attack.', 'under-attack');
  }
  update({ village: next });
}

export async function loadRaids(): Promise<void> {
  const [attack, defence] = await Promise.all([
    api.get<{ raids: RaidRow[] }>('/api/raids?role=attack'),
    api.get<{ raids: RaidRow[] }>('/api/raids?role=defence'),
  ]);
  applyRaids({ attack: attack.raids, defence: defence.raids });
}

function applyRaids(next: RaidLists): void {
  const prev = state.raids;
  if (prev) {
    for (const row of next.defence) {
      const before = prev.defence.find((p) => p.id === row.id);
      const wasOpen = !before || before.state === 'locked' || before.state === 'deploying';
      if (wasOpen && row.state === 'resolved') notify(`Your island was raided: ${row.stars} stars, ${row.destruction}% destroyed.`);
      if (wasOpen && row.state === 'abandoned') notify('The raid on your island was abandoned. Nothing moved.');
    }
  }
  update({ raids: next });
}

export async function loadRewards(): Promise<void> {
  const rewards = await api.get<Rewards>('/api/me/rewards');
  syncClock(rewards.serverTime);
  update({ rewards });
}

export async function loadMe(): Promise<void> {
  update({ me: await api.get<Me>('/api/me') });
}

export async function loadClan(): Promise<void> {
  const { clan } = await api.get<Pick<ClanBundle, 'clan'>>('/api/clan');
  if (clan === null) {
    const { invitations } = await api.get<{ invitations: Invitation[] }>('/api/me/invitations');
    applyClan({ clan: null, invitations });
    return;
  }
  const [{ messages }, requests] = await Promise.all([
    api.get<{ messages: ChatMessage[] }>('/api/clan/messages'),
    api.get<NonNullable<ClanBundle['requests']>>('/api/clan/requests'),
  ]);
  applyClan({ clan, messages, requests, invitations: [] });
}

let leavingClan = false;

/** Set around this tab's own leave, so it is not announced as a removal. */
export function setLeavingClan(on: boolean): void {
  leavingClan = on;
}

function applyClan(next: ClanBundle): void {
  const prev = state.clan;
  let unread = state.unread;
  if (prev?.clan && !next.clan && !leavingClan) {
    const name = prev.clan.name;
    update({ removedFrom: name });
    warn(`You are no longer in ${name}.`);
  }
  if (next.clan) update({ removedFrom: null });
  if (prev?.clan && next.clan && prev.clan.id === next.clan.id && next.messages && prev.messages) {
    const newest = Math.max(0, ...prev.messages.map((m) => m.id));
    const fresh = next.messages.filter((m) => m.id > newest && m.author.accountId !== state.me?.id);
    if (!state.chatVisible) unread += fresh.length;
  }
  if (!next.clan) unread = 0;
  update({ clan: next, unread });
}

export function setChatVisible(visible: boolean): void {
  if (visible === state.chatVisible) return;
  update(visible ? { chatVisible: true, unread: 0 } : { chatVisible: false });
}

let source: EventSource | null = null;

function connectLive(): void {
  disconnectLive();
  const es = new EventSource('/api/events');
  source = es;
  const on = (name: string, fn: (data: unknown) => void): void =>
    es.addEventListener(name, (event) => fn(JSON.parse((event as MessageEvent<string>).data) as unknown));
  on('me', (data) => update({ me: data as Me }));
  on('village', (data) => applyVillage(data as Village));
  on('rewards', (data) => update({ rewards: data as Rewards }));
  on('raids', (data) => applyRaids(data as RaidLists));
  on('clan', (data) => applyClan(data as ClanBundle));
  on('session', () => sessionEnded());
  on('status', (data) => {
    const down = (data as { database: string }).database === 'down';
    update({ outage: down });
    if (down) warn(OUTAGE);
  });
  es.onerror = () => {
    if (es.readyState !== EventSource.CLOSED || source !== es) return;
    void refreshSession()
      .then((me) => {
        if (!me) sessionEnded();
        else window.setTimeout(() => source === es && connectLive(), 3000);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.code === 'database_unavailable') window.setTimeout(() => source === es && connectLive(), 3000);
      });
  };
}

function disconnectLive(): void {
  source?.close();
  source = null;
}
