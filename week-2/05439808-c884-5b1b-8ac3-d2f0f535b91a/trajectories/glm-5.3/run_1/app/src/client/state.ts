// Client state: the signed-in islander, the server clock skew, and the live poller that keeps
// every open screen following changes made elsewhere within the two-second live bound.
import { api, type Me, type Village } from './api.ts';
import { SessionEnded } from './api.ts';
import { alertMessage, notice } from './ui.ts';

export const state = {
  me: null as Me | null,
  csrfReady: false,
  clockSkewMs: 0,
  signedOutBySelf: false,
  unreadClan: 0,
  clanChatVisible: false,
  village: null as Village | null,
  catalog: null as Awaited<ReturnType<typeof api<CatalogLike>>> | null,
};

type CatalogLike = { buildings: unknown[]; units: unknown[] };

export function serverNow(): number {
  return Date.now() + state.clockSkewMs;
}

export function observeServerTime(serverIso: string): void {
  const instant = Date.parse(serverIso);
  if (Number.isFinite(instant)) state.clockSkewMs = instant - Date.now();
}

type PollJob = () => Promise<void>;

const pollJobs = new Map<string, PollJob>();
let pollTimer: number | null = null;
let sessionCheckRunning = false;

export function setPollJob(name: string, job: PollJob | null): void {
  if (job === null) pollJobs.delete(name);
  else pollJobs.set(name, job);
}

function startPoller(): void {
  if (pollTimer !== null) return;
  pollTimer = window.setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    const jobs = [...pollJobs.entries()];
    for (const [, job] of jobs) {
      try {
        await job();
      } catch (err) {
        if (err instanceof SessionEnded) {
          handleSessionEnded();
          return;
        }
        // transient failures are retried on the next tick
      }
    }
    if (state.me !== null && !sessionCheckRunning) {
      sessionCheckRunning = true;
      try {
        const session = await api<{ user: Me | null }>('GET', '/api/session');
        if (session.user === null) {
          handleSessionEnded();
          return;
        }
        state.me = session.user;
      } catch (err) {
        if (err instanceof SessionEnded) {
          handleSessionEnded();
          return;
        }
      } finally {
        sessionCheckRunning = false;
      }
    }
  }, 1000);
}

export function handleSessionEnded(): void {
  if (state.signedOutBySelf) return;
  stopPoller();
  state.me = null;
  sessionStorage.setItem('saltreach-session-ended', '1');
  window.location.href = '/signin';
}

export function stopPoller(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  pollJobs.clear();
}

export function beginPolling(): void {
  startPoller();
}

// Signed-out notice shown after this tab's own sign-out; session-ended alert otherwise.
export function showPendingAuthNotices(): void {
  const signedOut = sessionStorage.getItem('saltreach-signed-out');
  const sessionEnded = sessionStorage.getItem('saltreach-session-ended');
  sessionStorage.removeItem('saltreach-signed-out');
  sessionStorage.removeItem('saltreach-session-ended');
  if (signedOut === '1') notice('You signed out.');
  if (sessionEnded === '1') alertMessage('Your session ended. Sign in again.');
}

export async function loadSessionAndUser(): Promise<Me | null> {
  const session = await api<{ user: Me | null; csrfToken: string }>('GET', '/api/session');
  const { setCsrfToken } = await import('./api.ts');
  setCsrfToken(session.csrfToken);
  state.me = session.user;
  return session.user;
}

export async function signOut(): Promise<void> {
  state.signedOutBySelf = true;
  try {
    await api('POST', '/api/auth/signout', {});
  } catch {
    // signing out proceeds even if the request fails
  }
  sessionStorage.setItem('saltreach-signed-out', '1');
  stopPoller();
  state.me = null;
  window.location.href = '/signin';
}

export function clanUnreadText(): string {
  if (state.unreadClan > 0 && !state.clanChatVisible) return `Clan (${state.unreadClan} unread)`;
  return 'Clan';
}
