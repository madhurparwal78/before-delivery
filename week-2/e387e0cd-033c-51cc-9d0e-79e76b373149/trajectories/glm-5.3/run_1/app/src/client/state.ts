// Session, workspace and polling state shared by the screens.
import { api } from './api.js';

export interface MemberInfo { id: string; name: string; email: string; role: string }
export interface WorkspaceInfo {
  slug: string; name: string; legalName: string; lei: string; jurisdictionCode: string;
  timeZone: string; city: string; currency: string; confirmationLimitCents: number; today: string; now: string;
}

export interface SessionState { member: MemberInfo; workspace: { slug: string; name: string }; home: string }

let session: SessionState | null = null;
const workspaces = new Map<string, WorkspaceInfo>();

export function setSession(s: SessionState | null): void {
  session = s;
}

export function getSession(): SessionState | null {
  return session;
}

export async function loadSession(): Promise<SessionState | null> {
  const res = await api<SessionState>('GET', '/api/session');
  if (res.ok && res.body !== null) {
    session = res.body;
    return session;
  }
  session = null;
  return null;
}

export async function workspace(slug: string): Promise<WorkspaceInfo | null> {
  const cached = workspaces.get(slug);
  if (cached !== undefined) return cached;
  const res = await api<{ workspace: WorkspaceInfo }>('GET', `/api/w/${slug}`);
  if (res.ok && res.body !== null) {
    workspaces.set(slug, res.body.workspace);
    return res.body.workspace;
  }
  return null;
}

export function invalidateWorkspace(slug: string): void {
  workspaces.delete(slug);
}

// --- polling with latest-response-wins ---
type Poller = { stop: () => void };
const pollers = new Set<Poller>();

export function startPolling(fn: () => Promise<void>, intervalMs = 5000): void {
  let stopped = false;
  let running = false;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    if (running) return;
    running = true;
    try {
      await fn();
    } catch {
      // polling errors are ignored; the next tick retries
    } finally {
      running = false;
    }
  };
  const handle = window.setInterval(() => {
    void tick();
  }, intervalMs);
  const poller: Poller = { stop: () => {
    stopped = true;
    window.clearInterval(handle);
  } };
  pollers.add(poller);
}

export function stopAllPolling(): void {
  for (const p of pollers) p.stop();
  pollers.clear();
}

// --- keeping what was typed across a session ending ---
export interface Stash { reason: 'session_ended' | 'access_removed'; route: string; dialog: string; values: Record<string, string> }

const STASH_KEY = 'lanternline:stash';

// Dialog openers registered by each screen so the dialog that was open before
// the session ended can be reopened with its fields filled.
const dialogOpeners = new Map<string, (values: Record<string, string>) => void>();

export function registerDialogOpener(name: string, opener: (values: Record<string, string>) => void): void {
  dialogOpeners.set(name, opener);
}

export function reopenDialog(name: string, values: Record<string, string>): void {
  const opener = dialogOpeners.get(name);
  if (opener !== undefined) opener(values ?? {});
}

export function saveStash(stash: Stash): void {
  try {
    sessionStorage.setItem(STASH_KEY, JSON.stringify(stash));
  } catch {
    // keep going without a stash
  }
}

export function takeStash(): Stash | null {
  try {
    const raw = sessionStorage.getItem(STASH_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(STASH_KEY);
    return JSON.parse(raw) as Stash;
  } catch {
    return null;
  }
}

export function peekStash(): Stash | null {
  try {
    const raw = sessionStorage.getItem(STASH_KEY);
    if (raw === null) return null;
    return JSON.parse(raw) as Stash;
  } catch {
    return null;
  }
}
