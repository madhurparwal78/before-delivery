// Sign-in and projects screens.
import { el, api } from './dom';
import { renderHeader, renderFooter } from './landing';
import type { Person, ProjectSummary, Workspace } from './types';

export function renderSignIn(root: HTMLElement): void {
  root.append(renderHeader(null));
  const panel = el('div', {
    class: 'panel',
    style: 'max-width:420px;margin:48px auto;padding:24px',
  });
  panel.append(el('h2', {}, 'Sign in'));
  const alert = el('div', { role: 'alert', class: 'alert-row', style: 'display:none' });
  const email = el('input', {
    type: 'email',
    'aria-label': 'Email',
    autocomplete: 'username',
    style: 'width:100%;margin:8px 0;padding:10px;background:var(--raised);border:1px solid var(--hairline);border-radius:4px',
  });
  const password = el('input', {
    type: 'password',
    'aria-label': 'Password',
    autocomplete: 'current-password',
    style: 'width:100%;margin:8px 0;padding:10px;background:var(--raised);border:1px solid var(--hairline);border-radius:4px',
  });
  const submit = el('button', { class: 'btn btn-primary', 'aria-label': 'Sign in', style: 'width:100%' }, 'Sign in');
  panel.append(alert, email, password, submit);
  root.append(panel);

  const go = async (): Promise<void> => {
    submit.textContent = 'Signing in…';
    submit.setAttribute('disabled', '');
    const res = await api<{ user: Person }>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ email: (email as HTMLInputElement).value, password: (password as HTMLInputElement).value }),
    });
    if (res.ok) {
      window.location.href = '/projects';
      return;
    }
    submit.textContent = 'Sign in';
    submit.removeAttribute('disabled');
    alert.textContent = res.message ?? 'Email or password is incorrect.';
    alert.style.display = 'block';
  };
  submit.addEventListener('click', () => void go());
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void go();
  });
  email.focus();
}

export async function renderProjects(root: HTMLElement, person: Person): Promise<void> {
  root.append(renderHeader(person));
  const me = await api<{ workspaces: Workspace[] }>('/api/me');
  const workspaces = me.data?.workspaces ?? [];

  const page = el('div', { class: 'page' });
  const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Projects' });
  const activeTab = el('button', { role: 'tab', 'aria-selected': 'true', 'aria-label': 'Active' }, 'Active');
  const trashTab = el('button', { role: 'tab', 'aria-selected': 'false', 'aria-label': 'Trash' }, 'Trash');
  tabs.append(activeTab, trashTab);
  page.append(tabs);

  const toolbar = el('div', { style: 'display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap' });
  const newBtn = el('button', { class: 'btn btn-primary', 'aria-label': 'New project' }, 'New project');
  const importBtn = el('button', { class: 'btn', 'aria-label': 'Import JSON' }, 'Import JSON');
  toolbar.append(newBtn, importBtn);
  page.append(toolbar);

  const listEl = el('div', { role: 'region', 'aria-label': 'Project list' });
  const trashEl = el('div', { role: 'region', 'aria-label': 'Trash list', style: 'display:none' });
  page.append(listEl, trashEl);
  root.append(page);
  root.append(renderFooter());

  const statusLine = el('div', { role: 'status', class: 'status-line' });
  page.append(statusLine);

  const load = async (): Promise<void> => {
    const active = await api<{ projects: ProjectSummary[] }>('/api/projects?status=active');
    listEl.textContent = '';
    const grid = el('div', { class: 'mosaic' });
    for (const project of active.data?.projects ?? []) {
      grid.append(projectCard(project, person));
    }
    if ((active.data?.projects ?? []).length === 0) {
      listEl.append(el('p', { class: 'muted' }, 'No projects yet.'));
    } else {
      listEl.append(grid);
    }
    const trash = await api<{ projects: ProjectSummary[] }>('/api/projects?status=trashed');
    trashEl.textContent = '';
    const ul = el('ul', { style: 'list-style:none;padding:0' });
    for (const project of trash.data?.projects ?? []) {
      const li = el('li', { role: 'listitem', class: 'panel' });
      li.append(
        el('span', {}, `${project.name} · purges on ${formatPurge(project.purgeAt)}`),
      );
      const restore = el('button', { class: 'btn', 'aria-label': `Restore ${project.name}` }, 'Restore');
      restore.addEventListener('click', async () => {
        await api(`/api/projects/${project.id}/restore`, { method: 'POST', body: '{}' });
        statusLine.textContent = `Restored ${project.name}.`;
        void load();
      });
      li.append(restore);
      ul.append(li);
    }
    trashEl.append(ul);
  };

  activeTab.addEventListener('click', () => {
    activeTab.setAttribute('aria-selected', 'true');
    trashTab.setAttribute('aria-selected', 'false');
    listEl.style.display = '';
    trashEl.style.display = 'none';
  });
  trashTab.addEventListener('click', () => {
    trashTab.setAttribute('aria-selected', 'true');
    activeTab.setAttribute('aria-selected', 'false');
    trashEl.style.display = '';
    listEl.style.display = 'none';
  });

  newBtn.addEventListener('click', () => {
    const dlg = el('dialog', { 'aria-label': 'New project' });
    dlg.append(el('h3', {}, 'New project'));
    const name = el('input', { 'aria-label': 'Project name', style: 'width:100%;margin:8px 0;padding:10px;background:var(--raised);border:1px solid var(--hairline);border-radius:4px' });
    const create = el('button', { class: 'btn btn-primary', 'aria-label': 'Create project' }, 'Create project');
    const cancel = el('button', { class: 'btn', 'aria-label': 'Cancel' }, 'Cancel');
    dlg.append(name, create, cancel);
    document.body.append(dlg);
    dlg.showModal();
    name.focus();
    cancel.addEventListener('click', () => dlg.close());
    create.addEventListener('click', async () => {
      const ws = workspaces[0]?.id;
      const res = await api<{ project: ProjectSummary }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: ws, name: (name as HTMLInputElement).value }),
      });
      if (res.ok) {
        dlg.close();
        window.location.href = `/projects/${res.data!.project.id}`;
      }
    });
  });

  importBtn.addEventListener('click', () => {
    const input = el('input', { type: 'file', accept: 'application/json', 'aria-label': 'Choose JSON file' });
    input.addEventListener('change', async () => {
      const file = (input as HTMLInputElement).files?.[0];
      if (!file) return;
      statusLine.textContent = `Importing ${file.name}…`;
      const form = new FormData();
      form.append('workspaceId', workspaces[0]?.id ?? '');
      form.append('file', file);
      const res = await api<{ project: ProjectSummary }>('/api/imports', { method: 'POST', body: form });
      if (res.ok) {
        statusLine.textContent = `Created ${res.data!.project.name} (imported).`;
        void load();
      } else {
        statusLine.textContent = res.message ?? 'Import failed.';
        statusLine.className = 'status-line amber';
      }
    });
    input.click();
  });

  await load();
}

function formatPurge(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

function projectCard(project: ProjectSummary, person: Person): HTMLElement {
  const card = el('article', {
    class: 'panel',
    'data-project-id': project.id,
    'data-layer-count': String(project.layerCount),
    'data-live-version': project.liveVersion === null ? '' : String(project.liveVersion),
    'data-editor-count': String(project.editorCount),
    'data-viewer-count': String(project.viewerCount),
  });
  const thumb = el('div', { class: 'thumb' });
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 140;
  drawThumb(canvas, project.liveVersion);
  thumb.append(canvas);
  card.append(thumb);

  const title = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' });
  title.append(el('h3', { style: 'font-size:16px' }, project.name));
  const open = el('a', { class: 'btn btn-primary', href: `/projects/${project.id}`, 'aria-label': `Open ${project.name}` }, 'Open');
  title.append(open);
  card.append(title);

  const layers = project.layerCount === 1 ? '1 layer' : `${project.layerCount} layers`;
  const live = project.liveVersion === null ? 'Not published' : `Live version ${project.liveVersion}`;
  const editors = project.editorCount === 1 ? '1 editor' : `${project.editorCount} editors`;
  const viewers = project.viewerCount === 1 ? '1 viewer' : `${project.viewerCount} viewers`;
  card.append(el('p', { class: 'small muted' }, layers));
  card.append(el('p', { class: 'small muted' }, live));
  card.append(el('p', { class: 'small muted' }, `${editors} · ${viewers}`));

  if (project.status === 'active') {
    const trash = el('button', { class: 'btn', 'aria-label': `Move ${project.name} to trash` }, 'Move to trash');
    trash.addEventListener('click', async () => {
      const res = await api(`/api/projects/${project.id}`, { method: 'DELETE' });
      if (res.ok) {
        card.dispatchEvent(new CustomEvent('refresh', { bubbles: true }));
        window.location.reload();
      }
    });
    card.append(trash);
  }
  void person;
  return card;
}

function drawThumb(canvas: HTMLCanvasElement, liveVersion: number | null): void {
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#101014';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (liveVersion === null) {
    // A dim still frame when nothing is published.
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const g = ctx.createRadialGradient(
    canvas.width * 0.7,
    canvas.height * 0.8,
    8,
    canvas.width * 0.7,
    canvas.height * 0.8,
    canvas.width * 0.7,
  );
  g.addColorStop(0, 'rgba(124,92,255,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}
