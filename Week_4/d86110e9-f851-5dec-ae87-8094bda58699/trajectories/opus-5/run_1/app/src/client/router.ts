import { api } from './api';
import { clear, h, replace } from './dom';
import { alertHolder, clearAlert, forgetDraftRegion, noticesRegion, runUpdates } from './regions';
import { footer, pillNav } from './shell';
import { connectStream, closeStream, setStreamHandlers } from './stream';
import { renderLanding } from './screens/landing';
import { renderSignUp, renderSignIn, renderConfirm, renderInvite } from './screens/auth';
import { renderWorkspaceHome } from './screens/workspace';
import { renderEditor } from './screens/editor';
import { renderRuns } from './screens/runs';
import { renderRunDetail } from './screens/runDetail';
import { renderTables, renderTableDetail } from './screens/tables';
import { renderMembers } from './screens/members';
import { renderPublicForm } from './screens/publicForm';
import { renderNotFound } from './screens/notFound';
import type { MeResponse, WorkspaceInfo } from '../shared/types';

export interface ScreenCtx {
  session: MeResponse | null;
  workspace: WorkspaceInfo | null;
  params: Record<string, string>;
}

type Renderer = (ctx: ScreenCtx) => Promise<HTMLElement>;

interface RouteEntry {
  pattern: RegExp;
  keys: string[];
  render: Renderer;
  workspaceParam?: string;
  draftParam?: string;
  landing?: boolean;
}

function route(path: string, render: Renderer, extra: Partial<RouteEntry> = {}): RouteEntry {
  const keys: string[] = [];
  const pattern = path
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment;
    })
    .join('/');
  return { pattern: new RegExp(`^${pattern}$`), keys, render, ...extra };
}

const routes: RouteEntry[] = [
  route('/', renderLanding, { landing: true }),
  route('/sign-up', renderSignUp),
  route('/sign-in', renderSignIn),
  route('/confirm/:token', renderConfirm),
  route('/invite/:token', renderInvite),
  route('/w/:ws', renderWorkspaceHome, { workspaceParam: 'ws' }),
  route('/w/:ws/automations/:aid', renderEditor, { workspaceParam: 'ws', draftParam: 'aid' }),
  route('/w/:ws/runs', renderRuns, { workspaceParam: 'ws' }),
  route('/w/:ws/runs/:rid', renderRunDetail, { workspaceParam: 'ws' }),
  route('/w/:ws/tables', renderTables, { workspaceParam: 'ws' }),
  route('/w/:ws/tables/:tid', renderTableDetail, { workspaceParam: 'ws' }),
  route('/w/:ws/members', renderMembers, { workspaceParam: 'ws' }),
  route('/forms/:slug/:path', renderPublicForm),
];

let session: MeResponse | null = null;
let shell: {
  root: HTMLElement;
  top: HTMLElement;
  nav: HTMLElement;
  main: HTMLElement;
  regions: HTMLElement;
  foot: HTMLElement;
} | null = null;
let pendingTopBar: HTMLElement | null = null;

/** A screen may place one bar above the pill nav, as the landing page does. */
export function setTopBar(element: HTMLElement | null): void {
  pendingTopBar = element;
}

export function currentSession(): MeResponse | null {
  return session;
}

export async function refreshSession(): Promise<void> {
  try {
    session = await api<MeResponse>('GET', '/api/me');
  } catch {
    session = null;
  }
}

export function navigate(path: string): void {
  if (path === window.location.pathname + window.location.search) {
    void render();
    return;
  }
  window.history.pushState({}, '', path);
  void render();
}

function buildShell(): void {
  const root = document.getElementById('app');
  if (root === null) return;
  clear(root);
  const top = h('div', { class: 'top-holder' });
  const nav = h('div', { class: 'nav-holder' });
  const main = h('main', { class: 'screen' });
  const regions = h('div', { class: 'regions' });
  const foot = h('div', { class: 'footer-holder' });
  root.append(top, nav, main, regions, foot);
  shell = { root, top, nav, main, regions, foot };
}

export async function render(): Promise<void> {
  if (shell === null) buildShell();
  if (shell === null) return;
  setStreamHandlers({});
  pendingTopBar = null;
  forgetDraftRegion();
  clearAlert();
  const pathname = window.location.pathname;
  let matched: { entry: RouteEntry; params: Record<string, string> } | null = null;
  for (const entry of routes) {
    const match = entry.pattern.exec(pathname);
    if (match === null) continue;
    const params: Record<string, string> = {};
    entry.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1]);
    });
    matched = { entry, params };
    break;
  }

  let workspace: WorkspaceInfo | null = null;
  let content: HTMLElement;
  const params = matched?.params ?? {};
  if (matched === null) {
    content = await renderNotFound();
  } else {
    const workspaceParam = matched.entry.workspaceParam;
    if (workspaceParam !== undefined) {
      try {
        workspace = await api<WorkspaceInfo>('GET', `/api/workspaces/${params[workspaceParam]}`);
      } catch {
        workspace = null;
      }
      if (workspace === null) {
        content = await renderNotFound();
        paint(content, workspace, false);
        closeStream();
        return;
      }
    } else {
      closeStream();
    }
    const ctx: ScreenCtx = { session, workspace, params };
    try {
      content = await matched.entry.render(ctx);
    } catch {
      content = await renderNotFound();
    }
    if (workspace !== null) {
      const draftParam = matched.entry.draftParam;
      connectStream(workspace.id, draftParam === undefined ? null : params[draftParam]);
    }
  }
  paint(content, workspace, matched?.entry.landing === true);
}

function paint(content: HTMLElement, workspace: WorkspaceInfo | null, landing: boolean): void {
  if (shell === null) return;
  replace(shell.top, pendingTopBar);
  replace(shell.nav, pillNav(session, workspace));
  replace(shell.main, content);
  replace(shell.regions, session !== null ? runUpdates : null, noticesRegion, alertHolder);
  replace(shell.foot, footer(session !== null));
  shell.root.classList.toggle('is-landing', landing);
  window.scrollTo(0, 0);
}

export function startRouter(): void {
  window.addEventListener('popstate', () => void render());
  let width = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === width) return;
    width = window.innerWidth;
    void render();
  });
}
