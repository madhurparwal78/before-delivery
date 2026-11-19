import { el } from './dom.js';
import { Workspace } from './workspace.js';
import {
  renderSignIn, renderSignUp, renderDiagramList,
  loadWorkspaceData, loadMe, loadOwnerName, showNotFound,
} from './screens.js';
import type { Role } from '../shared/model.js';

async function requireSession(): Promise<{ id: string; email: string; name: string } | null> {
  const res = await fetch('/api/me');
  if (!res.ok) return null;
  const body = await res.json() as { user: { id: string; email: string; name: string } };
  return body.user ?? null;
}

function redirectWithNext(): void {
  const next = encodeURIComponent(`${location.pathname}${location.search}`);
  location.href = `/signin?next=${next}`;
}

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;

  const path = location.pathname;
  if (path === '/signin') {
    renderSignIn(app);
    return;
  }
  if (path === '/signup') {
    renderSignUp(app);
    return;
  }

  const user = await requireSession();
  if (!user) {
    redirectWithNext();
    return;
  }

  if (path === '/' || path === '') {
    await renderDiagramList(app, user);
    return;
  }

  const match = /^\/d\/([A-Za-z0-9_]+)/.exec(path);
  if (!match) {
    showNotFound(app);
    return;
  }
  const diagramId = match[1]!;
  const params = new URLSearchParams(location.search);
  const versionId = params.get('version');
  const data = await loadWorkspaceData(diagramId);
  if (!data) {
    showNotFound(app);
    return;
  }
  const ownerName = await loadOwnerName(diagramId);
  const workspace = new Workspace(app, {
    document: data.document,
    role: data.role as Role,
    user,
    diagramId,
    versionId,
    ownerName,
  });
  await workspace.start();
}

void boot();
void el;

