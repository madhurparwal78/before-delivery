// Client entry: routes by path and loads the right page.
import { api, loadConfig, type Me } from './base.js';
import { initWorkspace } from './workspace.js';
import {
  renderLanding, renderSignup, renderSignin, renderProjects, renderProject,
  renderInvite, renderShare, renderEnded, pageDialog
} from './pages.js';
import { openDialog } from './panels.js';

async function boot(): Promise<void> {
  const path = window.location.pathname;
  let me: Me | null = null;
  try { me = await api.get('/api/me') as Me; } catch { me = null; }
  (window as unknown as { __me?: Me }).__me = me ?? undefined;
  pageDialog.openDialog = openDialog;

  if (path === '/' || path === '') { renderLanding(!!me); return; }
  if (path === '/signup') { renderSignup(); return; }
  if (path === '/signin') { renderSignin(); return; }
  if (path === '/projects') {
    if (!me) { window.location.href = '/signin'; return; }
    await renderProjects(me);
    return;
  }
  const projectMatch = path.match(/^\/projects\/(\d+)$/);
  if (projectMatch) {
    if (!me) { window.location.href = '/signin'; return; }
    await renderProject(Number(projectMatch[1]), me);
    return;
  }
  const workspaceMatch = path.match(/^\/projects\/(\d+)\/sprites\/(\d+)$/);
  if (workspaceMatch) {
    await loadConfig();
    await initWorkspace(Number(workspaceMatch[2]), Number(workspaceMatch[1]));
    return;
  }
  const inviteMatch = path.match(/^\/invites\/([^/]+)$/);
  if (inviteMatch) { await renderInvite(inviteMatch[1], me); return; }
  const shareMatch = path.match(/^\/s\/([^/]+)$/);
  if (shareMatch) { await renderShare(shareMatch[1]); return; }
  renderEnded();
}

void boot();

