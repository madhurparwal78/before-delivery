import { Identity, request, Workspace } from './api.js';
import { drawFaint } from './art.js';
import { el } from './dom.js';
import { connectLive, onLive } from './live.js';
import { renderShell } from './shell.js';
import { navigate, PageContext, startRouter } from './router.js';
import { renderExplorer } from './pages/explorer.js';
import { renderBlock, renderBlob, renderTransaction } from './pages/block.js';
import { renderSubmit, renderNodeList, renderNode } from './pages/work.js';
import { renderStake, renderVote, renderProposal, renderLedger, renderMembers } from './pages/money.js';
import { renderSignIn, renderInvite } from './pages/auth.js';
import { LiveEvent } from '../shared/live.js';

interface Route {
  pattern: RegExp;
  keys: string[];
  page: (context: PageContext) => Promise<void>;
}

const ROUTES: Route[] = [
  { pattern: /^\/w\/([^/]+)\/explorer$/, keys: ['id'], page: renderExplorer },
  { pattern: /^\/w\/([^/]+)\/explorer\/blocks\/(\d+)$/, keys: ['id', 'height'], page: renderBlock },
  { pattern: /^\/w\/([^/]+)\/explorer\/tx\/([^/]+)$/, keys: ['id', 'txId'], page: renderTransaction },
  { pattern: /^\/w\/([^/]+)\/blobs\/([^/]+)$/, keys: ['id', 'blobId'], page: renderBlob },
  { pattern: /^\/w\/([^/]+)\/submit$/, keys: ['id'], page: renderSubmit },
  { pattern: /^\/w\/([^/]+)\/nodes$/, keys: ['id'], page: renderNodeList },
  { pattern: /^\/w\/([^/]+)\/nodes\/([^/]+)$/, keys: ['id', 'nodeId'], page: renderNode },
  { pattern: /^\/w\/([^/]+)\/stake$/, keys: ['id'], page: renderStake },
  { pattern: /^\/w\/([^/]+)\/vote$/, keys: ['id'], page: renderVote },
  { pattern: /^\/w\/([^/]+)\/vote\/(\d+)$/, keys: ['id', 'number'], page: renderProposal },
  { pattern: /^\/w\/([^/]+)\/ledger$/, keys: ['id'], page: renderLedger },
  { pattern: /^\/w\/([^/]+)\/members$/, keys: ['id'], page: renderMembers },
];

let unsubscribes: (() => void)[] = [];
let refreshTimer = 0;

function scheduleRefresh(): void {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    void render(window.location.pathname, true);
  }, 40);
}

interface FormState {
  values: Map<string, string>;
  checked: Set<string>;
  focusId: string | null;
  scroll: number;
}

type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** A live update must not throw away what someone is typing. */
function captureFormState(): FormState {
  const values = new Map<string, string>();
  const checked = new Set<string>();
  for (const control of document.querySelectorAll<FormControl>('input, textarea, select')) {
    if (!control.id) continue;
    if (control instanceof HTMLInputElement && (control.type === 'radio' || control.type === 'checkbox')) {
      if (control.checked) checked.add(control.id);
      continue;
    }
    if (control instanceof HTMLInputElement && control.type === 'file') continue;
    values.set(control.id, control.value);
  }
  const active = document.activeElement as HTMLElement | null;
  return {
    values,
    checked,
    focusId: active?.id ? active.id : null,
    scroll: window.scrollY,
  };
}

function restoreFormState(state: FormState): void {
  for (const [id, value] of state.values) {
    const control = document.getElementById(id) as FormControl | null;
    if (control && control.value !== value) control.value = value;
  }
  for (const id of state.checked) {
    const control = document.getElementById(id) as HTMLInputElement | null;
    if (control) control.checked = true;
  }
  if (state.focusId) document.getElementById(state.focusId)?.focus();
  window.scrollTo(0, state.scroll);
}

/** Loading shows the strand canvas drawn very faintly, never a spinner. */
function loadingPanel(): HTMLElement {
  const canvas = el('canvas', { class: 'loading-canvas' });
  const panel = el(
    'div',
    { class: 'container section', attrs: { 'aria-busy': 'true' } },
    el('div', { class: 'panel' }, canvas),
  );
  requestAnimationFrame(() => drawFaint(canvas));
  return panel;
}

function notFound(): void {
  const shell = renderShell(null, window.location.pathname);
  shell.main.appendChild(
    el('div', { class: 'container section' }, [
      el('h1', { class: 'page-title', text: 'Not found' }),
      el('a', { class: 'pill pill-outline', attrs: { href: '/' } }, 'Back to the explorer'),
    ]),
  );
}

async function identityOrNull(): Promise<Identity | null> {
  const result = await request<Identity>('/api/me');
  return result.status === 200 ? result.body : null;
}

async function render(pathname: string, preserve = false): Promise<void> {
  const formState = preserve ? captureFormState() : null;
  for (const unsubscribe of unsubscribes) unsubscribe();
  unsubscribes = [];

  if (pathname === '/signin') {
    await renderSignIn();
    return;
  }
  const inviteMatch = /^\/invites\/([^/]+)$/.exec(pathname);
  if (inviteMatch) {
    await renderInvite(inviteMatch[1]);
    return;
  }

  const identity = await identityOrNull();
  if (!identity) {
    navigate('/signin');
    return;
  }
  if (pathname === '/' || pathname === '') {
    navigate(`/w/${identity.workspaces[0].id}/explorer`);
    return;
  }

  for (const route of ROUTES) {
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1]);
    });
    const workspaceResult = await request<Workspace>(`/api/w/${params.id}`);
    if (workspaceResult.status !== 200) {
      notFound();
      return;
    }
    const workspace = workspaceResult.body;
    connectLive(workspace.id);
    const shell = renderShell(workspace, pathname);
    shell.main.appendChild(loadingPanel());
    const context: PageContext = {
      main: shell.main,
      networkUpdates: shell.networkUpdates,
      workspace,
      identity,
      params,
      subscribe: (handler: (event: LiveEvent) => void) => {
        unsubscribes.push(onLive(handler));
      },
      refresh: scheduleRefresh,
    };
    shell.main.replaceChildren();
    await route.page(context);
    if (formState) restoreFormState(formState);
    return;
  }
  notFound();
}

startRouter(render);
