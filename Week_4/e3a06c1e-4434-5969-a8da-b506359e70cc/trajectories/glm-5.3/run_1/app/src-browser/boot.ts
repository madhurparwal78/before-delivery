// App boot: routes and popstate.

import { registerRoute, render } from './lib';
import { renderSignIn, renderJoin } from './auth-pages';
import { loadMe } from './console';
import { renderProjectsList, renderProject, renderUsage, renderMembers, renderPlan } from './console-pages';
import { renderSessionDetail } from './session-detail';

registerRoute('/', async () => { await renderPublic(); });
registerRoute('/sign-in', async () => { await renderSignIn(); });
registerRoute('/join/([A-Za-z0-9]+)', async () => {
  const token = location.pathname.split('/')[2] ?? '';
  await renderJoin(token);
});

async function requireSignIn(): Promise<boolean> {
  const me = await loadMe();
  if (!me) {
    history.replaceState(null, '', '/sign-in');
    await renderSignIn();
    return false;
  }
  return true;
}

async function renderPublic(): Promise<void> {
  const { publicPage } = await import('./public-site');
  document.title = 'Lowfield Console';
  const root = document.getElementById('root')!;
  root.innerHTML = '';
  root.append(await publicPage());
}

registerRoute('/console/projects', async () => {
  if (!(await requireSignIn())) return;
  await renderProjectsList();
});
registerRoute('/console/projects/([0-9a-f-]{36})/([a-z]+)', async () => {
  if (!(await requireSignIn())) return;
  const parts = location.pathname.split('/');
  await renderProject(parts[3] ?? '', parts[4] ?? 'keys');
});
registerRoute('/console/projects/([0-9a-f-]{36})', async () => {
  if (!(await requireSignIn())) return;
  const id = location.pathname.split('/')[3] ?? '';
  history.replaceState(null, '', `/console/projects/${id}/keys`);
  await renderProject(id, 'keys');
});
registerRoute('/console/sessions/([0-9a-f-]{36})', async () => {
  if (!(await requireSignIn())) return;
  const id = location.pathname.split('/')[3] ?? '';
  const segment = new URLSearchParams(location.search).get('segment');
  await renderSessionDetail(id, segment);
});
registerRoute('/console/usage', async () => {
  if (!(await requireSignIn())) return;
  await renderUsage();
});
registerRoute('/console/org/members', async () => {
  if (!(await requireSignIn())) return;
  await renderMembers();
});
registerRoute('/console/org/plan', async () => {
  if (!(await requireSignIn())) return;
  await renderPlan();
});

async function landingRoute(): Promise<string> {
  const me = (await loadMe())!;
  return me.user.role === 'billing' ? '/console/usage' : '/console/projects';
}

registerRoute('/console/?', async () => {
  if (!(await requireSignIn())) return;
  history.replaceState(null, '', await landingRoute());
  await render();
});
registerRoute('/console', async () => {
  if (!(await requireSignIn())) return;
  history.replaceState(null, '', await landingRoute());
  await render();
});

// Storage and billing outage events raised by the console pages.
window.addEventListener('lowfield:storage-outage', () => {
  const region = document.querySelector('[data-region="Service status"]') as HTMLElement | null;
  if (region) {
    const banner = document.createElement('div');
    banner.className = 'banner';
    banner.setAttribute('role', 'alert');
    banner.textContent = 'Audio storage is unreachable. Playback and uploads will resume once it\u2019s back, and nothing you\u2019ve typed is lost.';
    region.append(banner);
  }
});
window.addEventListener('lowfield:billing-outage', () => {
  const region = document.querySelector('[data-region="Service status"]') as HTMLElement | null;
  if (region) {
    const banner = document.createElement('div');
    banner.className = 'banner';
    banner.setAttribute('role', 'alert');
    banner.textContent = 'Billing is unreachable. Figures marked Pending will confirm automatically once it\u2019s back.';
    region.append(banner);
  }
});

window.addEventListener('popstate', () => { void render(); });
document.addEventListener('click', (ev) => {
  // Plain links inside the app navigate without a reload.
  const a = (ev.target as HTMLElement).closest('a');
  if (!a || a.target || a.hasAttribute('download')) return;
  const href = a.getAttribute('href');
  if (!href || !href.startsWith('/') || href.startsWith('//')) return;
  ev.preventDefault();
  history.pushState(null, '', href);
  void render();
});

void render();
