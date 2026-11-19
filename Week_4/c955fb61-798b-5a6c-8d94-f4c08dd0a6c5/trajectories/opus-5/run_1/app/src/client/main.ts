import { api } from './api.js';
import { state } from './state.js';
import { renderLanding, renderProjectsIndex, renderSignIn, renderSignUp } from './pages.js';
import { mountProjectPage } from './project.js';
import { mondayOf } from '../shared/dates.js';
import type { AppConfig, MeResponse } from '../shared/types.js';

async function boot(): Promise<void> {
  const root = document.getElementById('root')!;
  state.config = await api.get<AppConfig>('/api/config');
  state.workloadFrom = mondayOf(state.config.today);

  const path = location.pathname;
  if (path === '/signin') {
    renderSignIn(root);
    return;
  }
  if (path === '/signup') {
    renderSignUp(root);
    return;
  }

  try {
    const me = await api.get<MeResponse>('/api/me');
    state.me = me.user;
    state.workspaces = me.workspaces;
  } catch {
    state.me = null;
  }

  if (path === '/') {
    if (state.me) await renderProjectsIndex(root);
    else renderLanding(root);
  } else {
    await mountProjectPage(root, path.slice('/projects/'.length));
  }
}

void boot();
