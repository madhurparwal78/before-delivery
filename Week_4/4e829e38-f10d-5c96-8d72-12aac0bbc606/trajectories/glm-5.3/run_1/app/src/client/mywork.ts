import { h, clear, api } from './dom';
import { me } from './live';
import { renderTopbar } from './topbar';
import { DUE_STATUS_TEXT } from '../shared/labels';
import { Task } from '../shared/types';

export async function renderMyWork(root: HTMLElement): Promise<void> {
  const who = await me();
  if (!who) { window.location.href = '/account'; return; }
  const team = who.teams[0];
  clear(root);
  renderTopbar(root, { personName: who.name, unread: 0, active: 'mywork' });

  const main = h('main', { class: 'viewbody', style: 'max-width:1100px;margin:0 auto' });

  const tasks = who && team ? await api<{ projects: { id: string }[] }>('GET', `/api/teams/${team.id}/projects`).then(async pr => {
    const out: { task: Task; due: string }[] = [];
    for (const p of pr.data.projects ?? []) {
      const tr = await api<{ tasks: Task[] }>('GET', `/api/projects/${p.id}/tasks`);
      for (const t of tr.data.tasks ?? []) {
        if (t.assigneeId === who.id && !t.completed) out.push({ task: t, due: t.dueStatus });
      }
    }
    return out;
  }) : [];

  const groups = h('div', { class: 'stack' });
  const order: Task['dueStatus'][] = ['overdue', 'today', 'later', 'none'];
  const left = h('section', {});
  left.append(h('h2', { class: 'h5' }, 'My open tasks'));
  for (const status of order) {
    const items = tasks.filter(t => t.due === status);
    if (items.length === 0) continue;
    const list = h('ul', { style: 'list-style:none;padding:0;display:grid;gap:8px' });
    for (const item of items) {
      const chip = h('span', { class: `chipstatus ${status}` }, DUE_STATUS_TEXT[status]);
      list.append(h('li', {}, h('span', { class: 'row' }, h('a', { href: `/projects/${item.task.projectId}?view=list` }, item.task.name), chip)));
    }
    groups.append(h('div', {}, h('h3', { class: 'h5' }, DUE_STATUS_TEXT[status]), list));
  }
  if (tasks.length === 0) {
    groups.append(h('div', { class: 'empty' },
      h('p', {}, 'Nothing is assigned to you yet.'),
      h('a', { class: 'pill outline', href: '#projects', onclick: () => projAnchor.scrollIntoView() }, 'See projects')));
  }
  const projAnchor = h('div', { id: 'projects' });
  const projList = h('ul', { class: 'list Projects', style: 'list-style:none;padding:0;display:grid;gap:10px' });
  projList.setAttribute('aria-label', 'Projects');
  const projs = team ? await api<{ projects: { id: string; name: string; progress: number }[] }>('GET', `/api/teams/${team.id}/projects`) : null;
  for (const p of projs?.data.projects ?? []) {
    projList.append(h('li', {},
      h('a', { class: 'goallink', href: `/projects/${p.id}` },
        h('span', { class: 't' }, p.name),
        h('span', { class: 's num' }, `${Math.round(p.progress)}%`))));
  }
  const newProject = h('button', { class: 'pill primary', onclick: () => void openNewProject() }, 'New project');

  const openNewProject = async (): Promise<void> => {
    const { openDialog } = await import('./dom');
    openDialog((container, close) => {
      const name = h('input', { 'aria-label': 'Project name' }) as HTMLInputElement;
      name.style.minHeight = '44px'; name.style.borderRadius = '12px'; name.style.border = '1.5px solid var(--line-2)'; name.style.padding = '8px 12px';
      const sections = h('input', { 'aria-label': 'Sections' }) as HTMLInputElement;
      sections.style.minHeight = '44px'; sections.style.borderRadius = '12px'; sections.style.border = '1.5px solid var(--line-2)'; sections.style.padding = '8px 12px';
      const nameErr = h('div', { class: 'err' });
      const secErr = h('div', { class: 'err' });
      const create = h('button', {
        class: 'pill primary', onclick: async () => {
          nameErr.textContent = ''; secErr.textContent = '';
          const secs = sections.value.split(',').map(s => s.trim()).filter(Boolean);
          if (!name.value.trim()) { nameErr.textContent = 'Enter a project name'; name.setAttribute('aria-invalid', 'true'); return; }
          if (secs.length === 0) { secErr.textContent = 'Add at least one section'; sections.setAttribute('aria-invalid', 'true'); return; }
          const r = await api<{ id: string }>('POST', `/api/teams/${team!.id}/projects`, { name: name.value.trim(), sections: secs });
          if (r.ok) { close(); window.location.href = `/projects/${r.data.id}`; }
        },
      }, 'Create project');
      container.append(
        h('h2', {}, 'New project'),
        h('div', { class: 'field' }, h('label', {}, 'Project name'), name, nameErr),
        h('div', { class: 'field' }, h('label', {}, 'Sections (comma separated)'), sections, secErr),
        h('div', { class: 'actions' }, h('button', { class: 'pill quiet', onclick: close }, 'Cancel'), create));
    }, newProject);
  };

  const cols = h('div', { class: 'two-col cols-2', style: 'align-items:start' }, left, projAnchor);
  left.append(groups);
  projAnchor.append(h('h2', { class: 'h5' }, 'Projects'), projList, newProject);
  main.append(h('h1', {}, 'My work'), cols);
  root.append(main);
}
