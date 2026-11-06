import { api, setApiHooks } from './api.js';
import { copy } from './copy.js';
import { startKnockWatch } from './knockdialog.js';
import { accountModule } from './modules/account.js';
import { chatModule } from './modules/chat.js';
import { cycleModule } from './modules/cycle.js';
import { docDraft, docsModule } from './modules/docs.js';
import { issuesModule } from './modules/issues.js';
import { officeModule } from './modules/office.js';
import { settingsModule } from './modules/settings.js';
import { clearNotices, renderNotices } from './notices.js';
import { currentRoute, navigate, onRouteChange, startRouter, type Route } from './router.js';
import {
  renderCreateAccount,
  renderInvitations,
  renderSignIn,
  renderWelcome,
  setSignedOutNotice,
  type SignedIn,
} from './screens.js';
import {
  buildShell,
  mountModule,
  setSignOutHandler,
  teardownShell,
  type ModuleFactory,
  type ModuleId,
} from './shell.js';
import { onStreamEvent, startStream, stopStream } from './stream.js';
import { clearState, isOwner, rememberName, state, subscribe, update } from './store.js';
import type {
  ChannelSummary,
  Cycle,
  Person,
  ProjectSummary,
  ServiceStatus,
  Unread,
  Workspace,
} from '../shared/types.js';

const modules: Record<ModuleId, ModuleFactory> = {
  issues: issuesModule,
  cycle: cycleModule,
  chat: chatModule,
  docs: docsModule,
  office: officeModule,
  settings: settingsModule,
  account: accountModule,
};

let welcomeAllowed = false;

function safeNext(next: string | null): string | null {
  if (next === null || !next.startsWith('/')) return null;
  if (next.startsWith('//') || next.startsWith('/\\')) return null;
  return next;
}

async function loadStatus(): Promise<void> {
  try {
    const status = await api<ServiceStatus>('GET', '/api/status');
    update({ status });
  } catch {
    update({ status: { ...state.status, database: 'unavailable' } });
  }
  renderNotices();
}

async function loadWorkspace(): Promise<void> {
  if (state.person === null || state.workspace === null) return;
  try {
    const workspace = await api<Workspace>('GET', '/api/workspace');
    update({ workspace });
  } catch {
    // The refresh retries; the notices report the outage.
  }
}

export async function loadScopes(): Promise<void> {
  if (state.workspace === null) return;
  const [projects, channels, members, unread, cycle] = await Promise.all([
    api<{ projects: ProjectSummary[] }>('GET', '/api/projects').catch(() => ({ projects: [] })),
    api<{ channels: ChannelSummary[] }>('GET', '/api/channels').catch(() => ({ channels: [] })),
    api<{ members: Person[] }>('GET', '/api/members').catch(() => ({ members: [] })),
    api<Unread>('GET', '/api/unread').catch(() => ({ channels: {}, inbox: 0 })),
    api<Cycle>('GET', '/api/cycles/current').catch(() => null),
  ]);
  for (const person of members.members) rememberName(person.id, person.name);
  update({
    projects: projects.projects,
    channels: channels.channels,
    members: members.members,
    unread,
    currentCycle: cycle === null ? state.currentCycle : cycle.number,
  });
}

/**
 * A lost session discards everything the page holds for that person. An unsaved
 * doc edit is the one exception, unless the person signed out deliberately.
 */
function endSession(notice: string, keepDraft: boolean): void {
  const draftPath = keepDraft ? docDraft.keepForSignIn() : null;
  stopStream();
  clearState();
  clearNotices();
  teardownShell();
  setSignedOutNotice(notice);
  navigate(draftPath === null ? '/sign-in' : `/sign-in?next=${encodeURIComponent(draftPath)}`, {
    replace: true,
  });
  if (currentRoute().segments[0] === 'sign-in') render(currentRoute());
}

async function signOut(): Promise<void> {
  docDraft.discard();
  await api('DELETE', '/api/session').catch(() => undefined);
  endSession(copy.signedOut, false);
}

function onUnauthenticated(): void {
  if (state.person === null) return;
  endSession(copy.signedOut, true);
}

function afterSignIn(result: SignedIn, next: string | null): void {
  update({ person: result.person, workspace: result.workspace });
  void startSignedIn();
  if (result.workspace === null) navigate('/invitations', { replace: true });
  else navigate(safeNext(next) ?? '/issues', { replace: true });
}

async function startSignedIn(): Promise<void> {
  if (state.workspace !== null) {
    startStream();
    await loadScopes();
  }
  await loadStatus();
}

function moduleOf(route: Route): ModuleId | null {
  const first = route.segments[0];
  if (first === undefined) return null;
  if (first === 'issues' || first === 'cycle' || first === 'chat' || first === 'docs') return first;
  if (first === 'office' || first === 'settings' || first === 'account') return first;
  return null;
}

export function render(route: Route): void {
  const signedIn = state.person !== null;
  const hasWorkspace = state.workspace !== null;
  const path = route.segments[0] ?? '';

  if (path === 'sign-in' || path === 'create-account') {
    if (signedIn && hasWorkspace) return redirect('/issues');
    if (signedIn) return redirect('/invitations');
    teardownShell();
    if (path === 'sign-in') renderSignIn(route.query.get('next'), afterSignIn);
    else {
      renderCreateAccount((result) => {
        afterSignIn(result, '/invitations');
      });
    }
    renderNotices();
    return;
  }
  if (!signedIn) {
    const wanted = `${route.path}${route.search}`;
    return redirect(path === '' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(wanted)}`);
  }
  if (path === 'invitations') {
    if (hasWorkspace) return redirect('/issues');
    teardownShell();
    renderInvitations((workspace, person) => {
      update({ workspace, person });
      welcomeAllowed = true;
      void startSignedIn();
      redirect('/welcome');
    });
    renderNotices();
    return;
  }
  if (path === 'welcome') {
    if (!hasWorkspace) return redirect('/invitations');
    if (!welcomeAllowed) return redirect('/issues');
    welcomeAllowed = false;
    teardownShell();
    renderWelcome();
    renderNotices();
    return;
  }
  if (!hasWorkspace) return redirect('/invitations');
  if (path === '') return redirect('/issues');

  const id = moduleOf(route);
  if (id === null) return redirect('/issues');
  if (id === 'settings' && !isOwner()) return redirect('/issues');
  if (id === 'account' && isOwner()) return redirect('/settings');
  buildShell();
  mountModule(id, modules[id], route);
  renderNotices();
}

function redirect(to: string): void {
  navigate(to, { replace: true });
}

async function boot(): Promise<void> {
  setApiHooks({
    onUnauthenticated,
    onServiceTrouble: () => {
      void loadStatus();
    },
  });
  setSignOutHandler(signOut);
  startRouter();
  onRouteChange((route) => {
    render(route);
  });
  subscribe((keys) => {
    if (keys.has('status') || keys.has('workspace') || keys.has('billing')) renderNotices();
  });

  try {
    const me = await api<{ person: Person; workspace: Workspace | null }>('GET', '/api/me');
    update({ person: me.person, workspace: me.workspace });
  } catch {
    update({ person: null, workspace: null });
  }
  if (state.person !== null) await startSignedIn();
  else await loadStatus();
  render(currentRoute());
  startKnockWatch();

  window.setInterval(() => {
    void loadWorkspace();
    void loadStatus();
  }, 10000);

  onStreamEvent((event) => {
    if (event.name === 'notice') void loadStatus();
    if (event.name === 'unread') update({ unread: event.data as unknown as Unread });
    if (event.name === 'reset') void loadScopes();
    if (event.name === 'revoked') {
      if (event.data.scope === 'workspace') endSession(copy.signedOut, true);
      else void loadScopes();
    }
  });

  let lastBeat = 0;
  const beat = (): void => {
    if (state.workspace === null || Date.now() - lastBeat < 30000) return;
    lastBeat = Date.now();
    void api('POST', '/api/presence/heartbeat', { body: {} }).catch(() => undefined);
  };
  for (const name of ['pointerdown', 'keydown', 'pointermove'] as const) {
    window.addEventListener(name, beat, { passive: true });
  }
}

void boot();
