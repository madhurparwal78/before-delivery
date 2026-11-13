import type { SessionResponse } from '../shared/types.js';
import { ApiCallFailed, get } from './api.js';
import { el, mount } from './dom.js';
import { clearProblem, problem } from './live.js';
import { navigate, startRouting } from './router.js';
import { renderApprovalLink } from './views/approval-link.js';
import { renderSignIn } from './views/sign-in.js';
import { renderWindows } from './views/windows.js';
import { renderWorkspace } from './views/workspace.js';

async function currentSession(): Promise<SessionResponse | null> {
  try {
    return await get<SessionResponse>('/api/session');
  } catch (cause) {
    if (cause instanceof ApiCallFailed && cause.failure.code === 'unauthenticated') return null;
    throw cause;
  }
}

function closeAnyDialogs(): void {
  for (const scrim of document.querySelectorAll('.scrim')) scrim.remove();
}

async function route(): Promise<void> {
  const url = new URL(window.location.href);
  const path = url.pathname;
  closeAnyDialogs();
  clearProblem();

  const approval = /^\/approvals\/([^/]+)$/.exec(path);
  if (approval?.[1]) {
    await renderApprovalLink(approval[1]);
    return;
  }

  const session = await currentSession();
  if (path === '/sign-in' || path === '/') {
    if (session) {
      const first = session.memberships[0];
      navigate(first ? `/projects/${first.project}` : '/sign-in');
      if (first) return;
    }
    renderSignIn({ next: url.searchParams.get('next') ?? '/sign-in', sessionEnded: url.searchParams.has('ended') });
    return;
  }

  if (!session) {
    navigate(`/sign-in?next=${encodeURIComponent(path + url.search)}`);
    return;
  }

  const windows = /^\/projects\/([^/]+)\/windows$/.exec(path);
  if (windows?.[1]) {
    await renderWindows(windows[1], session);
    return;
  }

  const workspace = /^\/projects\/([^/]+)$/.exec(path);
  if (workspace?.[1]) {
    await renderWorkspace(workspace[1], session, {
      stage: url.searchParams.get('stage'),
      promotion: url.searchParams.get('promotion'),
    });
    return;
  }

  mount(el('main', { class: 'approval' }, [el('div', { class: 'approval__panel' }, [el('h1', {}, ['Not found'])])]));
}

startRouting(() => {
  void route().catch((cause: unknown) => {
    if (cause instanceof ApiCallFailed && cause.failure.code === 'unauthenticated') {
      navigate('/sign-in?ended=1');
      return;
    }
    problem('Keelson could not reach the server. Your last action was not confirmed.');
  });
});
