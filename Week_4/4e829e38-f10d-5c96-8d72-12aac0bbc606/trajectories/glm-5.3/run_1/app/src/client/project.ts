import { h, clear, api, announce, openDialog, toastHost, esc, focusBelowBar, statusRegion } from './dom';
import { subscribeLive, LiveEvent, me } from './live';
import { renderTopbar, outageBand } from './topbar';
import { animateMove, animateFade, animateRunEntry } from './motion';
import { ProjectData, TasksPage, Task, FieldRecord, valueText, cellAria } from './types';
import { DUE_STATUS_TEXT, APPROVAL_TEXT } from '../shared/labels';
import { TaskDetail } from '../shared/types';

interface State {
  project: ProjectData | null;
  tasks: Task[];
  selection: Set<string>;
  focusTaskId: string | null;
  view: 'list' | 'board' | 'timeline';
  trace: string[] | null;
}

export async function renderProject(root: HTMLElement): Promise<void> {
  const who = await me();
  if (!who) { window.location.href = '/account'; return; }
  const parts = window.location.pathname.split('/').filter(Boolean);
  const pid = parts[1] ?? '';
  const viewParam = new URLSearchParams(window.location.search).get('view') ?? 'list';
  const state: State = {
    project: null, tasks: [], selection: new Set(), focusTaskId: null,
    view: (['list', 'board', 'timeline'].includes(viewParam) ? viewParam : 'list') as State['view'],
    trace: null,
  };

  const projRes = await api<ProjectData>('GET', `/api/projects/${pid}`);
  if (projRes.status === 404) { renderNotFound(root); return; }
  state.project = projRes.data;

  const tasksRes = await api<TasksPage>('GET', `/api/projects/${pid}/tasks?page=1`);
  state.tasks = tasksRes.data.tasks ?? [];
  refreshSectionOrder(state.project);

  clear(root);
  renderTopbar(root, { personName: who.name, unread: 0, active: null });

  const shell = h('div', { class: 'workshell' });
  const rail = h('aside', { class: 'projectrail', 'aria-label': 'Project panel' });
  const main = h('div', {});
  const head = h('div', { class: 'viewhead' });
  const body = h('div', { class: 'viewbody' });
  shell.append(rail, main);
  main.append(head, body);
  root.append(shell);

  const buildRail = (): void => {
    clear(rail);
    const proj = state.project!;
    rail.append(h('h2', { class: 'h5' }, proj.name));
    rail.append(h('button', { class: 'chip', style: 'width:100%;justify-content:center', onclick: () => { railOpen = !railOpen; rail.hidden = !railOpen; railBtn.setAttribute('aria-expanded', String(railOpen)); } }, 'Toggle panel'));
    rail.append(h('a', { href: `/projects/${proj.id}?view=list` }, 'Tasks'));
    rail.append(h('a', { href: `/projects/${proj.id}/rules` }, 'Rules'));
    rail.append(h('a', { href: `/workload/${proj.teamId}` }, 'Workload'));
    rail.append(h('a', { href: '/goals' }, 'Goals'));
  };
  let railOpen = window.innerWidth >= 1280;
  rail.hidden = !railOpen;

  const railBtn = h('button', {
    class: 'pill quiet', 'aria-expanded': String(railOpen), 'aria-controls': 'panel',
    onclick: () => { railOpen = !railOpen; rail.hidden = !railOpen; railBtn.setAttribute('aria-expanded', String(railOpen)); },
  }, 'Project panel');

  const tabs = h('div', { class: 'tablist', role: 'tablist', 'aria-label': 'Project views' });
  for (const v of ['list', 'board', 'timeline'] as const) {
    tabs.append(h('button', {
      class: 'chip', role: 'tab', 'aria-selected': String(state.view === v),
      onclick: () => { window.location.search = `view=${v}`; },
    }, v[0].toUpperCase() + v.slice(1)));
  }
  head.append(railBtn, tabs,
    h('a', { class: 'chip', href: `/workload/${state.project!.teamId}` }, 'Workload'),
    h('a', { class: 'chip', href: `/projects/${state.project!.id}/rules` }, 'Rules'),
    h('button', { class: 'chip', onclick: () => void downloadDialog() }, 'Download project'));

  const downloadDialog = async (): Promise<void> => {
    openDialog((container, close) => {
      const csv = h('input', { type: 'radio', name: 'fmt', id: 'fmt-csv', value: 'csv' }) as HTMLInputElement;
      csv.checked = true;
      const json = h('input', { type: 'radio', name: 'fmt', id: 'fmt-json', value: 'json' }) as HTMLInputElement;
      const dlStatus = h('div', { id: 'download-status', role: 'status', 'aria-live': 'polite', 'data-status': 'idle' });
      let link: HTMLElement | null = null;
      const prepare = h('button', {
        class: 'pill primary', onclick: async () => {
          const fmt = (container.querySelector('input[name="fmt"]:checked') as HTMLInputElement).value;
          dlStatus.setAttribute('data-status', 'preparing');
          dlStatus.textContent = 'Preparing';
          const started = await api<{ id: string }>('POST', `/api/projects/${pid}/files`, { format: fmt });
          if (!started.ok) return;
          for (let i = 0; i < 40; i++) {
            const st = await api<{ status: string; url?: string; error?: string }>('GET', `/api/files/${started.data.id}`);
            if (st.data.status === 'ready') {
              dlStatus.setAttribute('data-status', 'ready');
              dlStatus.textContent = 'Ready';
              if (link) link.remove();
              link = h('a', { class: 'pill outline', href: st.data.url ?? '#' }, fmt === 'csv' ? 'Download CSV' : 'Download JSON');
              container.append(link);
              return;
            }
            if (st.data.status === 'failed') {
              dlStatus.setAttribute('data-status', 'failed');
              dlStatus.textContent = 'Download failed: file storage is unavailable. Nothing was saved.';
              outageBand(document.body, true);
              return;
            }
            await new Promise(r => setTimeout(r, 250));
          }
        },
      }, 'Prepare file');
      container.append(h('h2', {}, 'Download project'),
        h('div', { class: 'row' }, h('label', { for: 'fmt-csv' }, csv, ' CSV'), h('label', { for: 'fmt-json' }, json, ' JSON')),
        prepare, dlStatus,
        h('div', { class: 'actions' }, h('button', { class: 'pill quiet', onclick: close }, 'Cancel')));
    });
  };

  buildRail();
  statusRegion('List status', 'polite');
  statusRegion('Board status', 'assertive');
  statusRegion('Timeline status', 'polite');
  statusRegion('Notifications', 'polite');

  const render = (): void => {
    clear(body);
    if (state.view === 'list') renderList(body, state);
    else if (state.view === 'board') renderBoard(body, state);
    else renderTimeline(body, state);
  };
  render();
  rerenderHook = render;

  /* live updates */
  const applyEvent = (ev: LiveEvent): void => {
    if (ev.kind === 'task' || ev.kind === 'task_added') {
      const data = ev.data as { task?: Task } | undefined;
      if (data?.task) {
        const t = data.task;
        const i = state.tasks.findIndex(x => x.id === t.id);
        if (i >= 0) state.tasks[i] = t;
        else state.tasks.push(t);
        state.tasks.sort(taskOrder);
        if (state.view === 'list') renderList(body, state);
        else if (state.view === 'board') renderBoard(body, state);
        else renderTimeline(body, state);
      }
    } else if (ev.kind === 'task_deleted') {
      const d = ev.data as { taskId: string };
      state.tasks = state.tasks.filter(t => t.id !== d.taskId);
      render();
    } else if (ev.kind === 'successor') {
      const d = ev.data as { taskId: string };
      void api<TasksPage>('GET', `/api/projects/${pid}/tasks?page=1`).then(r => {
        const fresh = r.data.tasks?.find(t => t.id === d.taskId);
        if (fresh) {
          state.tasks.push(fresh);
          state.tasks.sort(taskOrder);
          render();
          announce('List status', `${fresh.name} repeats on ${fresh.due}`);
        }
      });
    } else if (ev.kind === 'trace') {
      const d = ev.data as { tasks: string[]; projectId: string };
      if (d.projectId === pid) {
        state.trace = d.tasks;
        render();
        drawTrace(body, state);
      }
    }
  };
  subscribeLive(applyEvent);
  const inbox = await api<{ unread: number }>('GET', '/api/inbox');
  const link = document.getElementById('inbox-link');
  if (link) link.textContent = `Inbox, ${inbox.data.unread ?? 0} unread`;
}

function taskOrder(a: Task, b: Task): number {
  const sa = stateSections.get(a.section) ?? 99;
  const sb = stateSections.get(b.section) ?? 99;
  if (sa !== sb) return sa - sb;
  if (a.parentId !== b.parentId) return a.parentId === null ? -1 : 1;
  return a.position - b.position;
}

const stateSections = new Map<string, number>();
function refreshSectionOrder(proj: ProjectData | null): void {
  stateSections.clear();
  for (const s of proj?.sections ?? []) stateSections.set(s.id, s.position);
}

function renderNotFound(root: HTMLElement): void {
  clear(root);
  const main = h('main', { class: 'empty', style: 'margin:60px auto;max-width:560px' },
    h('h1', {}, 'Project not found'),
    h('p', {}, 'This project is outside your teams or does not exist.'),
    h('a', { class: 'pill primary', href: '/' }, 'My work'));
  root.append(main);
}

/* ---------- list view ---------- */

function renderList(body: HTMLElement, state: State): void {
  const proj = state.project!;
  const membersById = new Map(proj.members.map(m => [m.id, m.name]));
  const sections = [...proj.sections].sort((a, b) => a.position - b.position);

  const tools = h('div', { class: 'row', style: 'margin-bottom:12px' });
  for (const f of proj.fields.filter(f => f.type === 'multi_select')) {
    tools.append(h('button', {
      class: 'pill outline', 'aria-label': `Set ${f.name} for selection`,
      onclick: () => openTagsDialog(f, state),
    }, `Set ${f.name} for selection`));
  }
  tools.append(h('button', { class: 'pill outline', 'aria-label': 'Add field', onclick: () => openAddField(state) }, 'Add field'));
  for (const f of proj.fields.filter(f => f.type === 'formula')) {
    tools.append(h('button', { class: 'pill outline', 'aria-label': `Edit formula for ${f.name}`, onclick: () => openFormulaEditor(f, state) }, `Edit formula for ${f.name}`));
  }
  body.append(tools);

  const grid = h('div', { role: 'grid', 'aria-label': 'Tasks' });
  const cols = ['Name', 'Assignee', 'Due', 'Effort', ...proj.fields.map(f => f.name), 'Status'];
  const head = h('div', { role: 'row', class: 'tasktable', style: 'display:grid;grid-template-columns:2fr 1fr 1fr 0.7fr repeat(' + proj.fields.length + ', 1fr) 1fr;border-bottom:1px solid var(--line)' },
    ...cols.map((c, i) => h('div', { role: 'columnheader', 'aria-colindex': String(i + 1), class: c === 'Effort' ? 'num' : '' }, c)));

  grid.append(head);

  for (const section of sections) {
    const secTasks = state.tasks.filter(t => t.section === section.id && t.parentId === null);
    const block = h('div', { class: 'sectionblock', role: 'rowgroup', 'aria-label': section.name });
    const secHead = h('button', { class: 'pill quiet', onclick: () => void 0 }, section.name);
    const del = h('button', {
      class: 'pill quiet', 'aria-label': 'Delete section', disabled: sections.length <= 1,
      onclick: () => confirmDelete(`Delete ${section.name}?`, async () => {
        await api('DELETE', `/api/sections/${section.id}`);
        announce('List status', 'Section deleted');
        window.location.reload();
      }, secHead),
    }, 'Delete section');
    block.append(h('div', { class: 'sectionhead' }, secHead, del));

    for (const task of secTasks) {
      block.append(rowFor(task, 1, state, membersById));
      for (const sub of state.tasks.filter(t => t.parentId === task.id)) {
        block.append(rowFor(sub, 2, state, membersById));
      }
    }

    const addInput = h('input', { class: 'addrow-input', type: 'text' }) as HTMLInputElement;
    addInput.setAttribute('aria-label', 'Add task');
    addInput.placeholder = 'Add task';
    addInput.style.minHeight = '44px';
    addInput.style.border = 'none';
    addInput.style.background = 'none';
    addInput.style.fontSize = '16px';
    if (activeAddTask === section.id) {
      activeAddTask = null;
      requestAnimationFrame(() => addInput.focus());
    }
    addInput.addEventListener('keydown', async e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const name = addInput.value.trim();
      if (!name) return;
      addInput.setAttribute('aria-busy', 'true');
      const r = await api<Task>('POST', `/api/projects/${proj.id}/tasks`, { name, section: section.id });
      addInput.removeAttribute('aria-busy');
      if (r.ok) {
        addInput.value = '';
        state.tasks.push(r.data);
        state.tasks.sort(taskOrder);
        activeAddTask = section.id;
        rerenderHook?.();
      }
    });
    block.append(h('div', { class: 'addrow', style: 'min-height:44px;display:flex;align-items:center' }, addInput));
    grid.append(block);
  }
  body.append(grid);
}

function rowFor(task: Task, level: number, state: State, membersById: Map<string, string>): HTMLElement {
  const proj = state.project!;
  const cells: HTMLElement[] = [];
  const openBtn = h('button', { class: 'cellbtn', 'aria-label': `Open ${task.name}`, onclick: () => openDetail(task, state) }, task.name);
  const nameCell = h('div', { role: 'gridcell', 'aria-colindex': '1' }, openBtn);
  cells.push(nameCell);
  const assigneeText = task.assigneeId ? membersById.get(task.assigneeId) ?? '' : '';
  cells.push(h('div', { role: 'gridcell', 'aria-colindex': '2' }, assigneeText));
  cells.push(h('div', { role: 'gridcell', 'aria-colindex': '3', class: 'num' }, task.due ?? ''));
  cells.push(h('div', { role: 'gridcell', 'aria-colindex': '4', class: 'num' }, task.effort === null ? '' : String(task.effort)));
  let col = 5;
  for (const f of proj.fields) {
    const v = task.values[f.name] ?? null;
    const text = valueText(v);
    cells.push(h('div', { role: 'gridcell', 'aria-colindex': String(col), 'aria-label': cellAria(f, v), class: 'num' }, text));
    col++;
  }
  cells.push(h('div', { role: 'gridcell' },
    h('span', { class: `chipstatus ${task.dueStatus}` }, DUE_STATUS_TEXT[task.dueStatus])));

  const tr = h('div', {
    role: 'row', 'data-task': task.id, 'aria-level': String(level),
    'aria-selected': String(state.selection.has(task.id)),
    'data-parent': task.parentId ?? '',
    class: `taskrow ${task.parentId ? 'subtask' : ''}`,
    tabindex: '0',
    style: `display:grid;grid-template-columns:2fr 1fr 1fr 0.7fr repeat(${proj.fields.length}, 1fr) 1fr;min-height:44px;align-items:center;border-bottom:1px solid var(--line)${task.parentId ? ';padding-left:24px' : ''}`,
  }, ...cells);

  tr.addEventListener('keydown', e => {
    if (e.target !== tr) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (e.shiftKey) {
        const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-task]'));
        const i = rows.indexOf(tr);
        const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
        if (next) {
          state.selection.add(task.id);
          state.selection.add(next.dataset.task!);
          rerenderAll();
          announce('List status', `${state.selection.size} ${state.selection.size === 1 ? 'task' : 'tasks'} selected`);
        }
        return;
      }
      if (state.selection.size > 0) {
        state.selection.clear();
        rerenderAll();
      }
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-task]'));
      const i = rows.indexOf(tr);
      const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) next.focus();
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const cellIdx = Array.from(tr.children).findIndex(c => c.contains(document.activeElement));
      return;
    }
    if (e.ctrlKey && (e.key === ']' || e.key === '[')) {
      e.preventDefault();
      void indentTask(task, e.key === ']', state);
      return;
    }
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      void toggleComplete(task, state, tr);
      return;
    }
  });
  return tr;
}

let rerenderHook: (() => void) | null = null;
function rerenderAll(): void { rerenderHook?.(); }
let activeAddTask: string | null = null;

async function indentTask(task: Task, indent: boolean, state: State): Promise<void> {
  if (indent) {
    if (task.parentId) { announce('List status', `Can't indent ${task.name}`); return; }
    const hasSubs = state.tasks.some(t => t.parentId === task.id);
    if (hasSubs) { announce('List status', `Can't indent ${task.name}`); return; }
    const sameSection = state.tasks.filter(t => t.section === task.section && !t.parentId);
    const idx = sameSection.findIndex(t => t.id === task.id);
    if (idx <= 0) { announce('List status', `Can't indent ${task.name}`); return; }
    const parent = sameSection[idx - 1];
    const r = await api<Task>('PATCH', `/api/tasks/${task.id}`, { version: task.version, parentId: parent.id });
    if (r.status === 422) { announce('List status', `Can't indent ${task.name}`); return; }
    announce('List status', `${task.name} is now a subtask of ${parent.name}`);
  } else {
    if (!task.parentId) { announce('List status', `Can't outdent ${task.name}`); return; }
    const r = await api<Task>('PATCH', `/api/tasks/${task.id}`, { version: task.version, parentId: null });
    if (r.status === 422) { announce('List status', `Can't outdent ${task.name}`); return; }
    announce('List status', `${task.name} is no longer a subtask`);
  }
}

async function toggleComplete(task: Task, state: State, row: HTMLElement): Promise<void> {
  const r = await api<Task>('PATCH', `/api/tasks/${task.id}`, { version: task.version, completed: !task.completed });
  if (!r.ok) { toastHost().show("Couldn't save. Nothing changed."); return; }
  announce('List status', `${task.name} marked ${r.data.completed ? '' : 'not '}complete`.replace('marked ', r.data.completed ? 'marked complete' : 'marked not complete'));
  if (r.data.completed) {
    const fresh = await api<TasksPage>('GET', `/api/projects/${task.projectId}/tasks?page=1`);
    state.tasks = fresh.data.tasks ?? [];
  } else {
    const i = state.tasks.findIndex(t => t.id === task.id);
    if (i >= 0) state.tasks[i] = r.data;
  }
  rerenderHook?.();
  row.focus();
}

function openTagsDialog(field: FieldRecord, state: State): void {
  openDialog((container, close) => {
    const checks = (field.options ?? []).map(o => {
      const cb = h('input', { type: 'checkbox', value: o }) as HTMLInputElement;
      cb.id = `tag-${o}`;
      return { cb, o };
    });
    const apply = h('button', {
      class: 'pill primary', onclick: async () => {
        const chosen = checks.filter(c => c.cb.checked).map(c => c.o);
        for (const id of state.selection) {
          const t = state.tasks.find(x => x.id === id);
          if (!t) continue;
          await api('PATCH', `/api/tasks/${id}`, { version: t.version, values: { [field.name]: chosen } });
        }
        announce('List status', `${field.name} set on ${state.selection.size} ${state.selection.size === 1 ? 'task' : 'tasks'}`);
        close();
        rerenderHook?.();
      },
    }, 'Apply tags');
    container.append(h('h2', {}, `Set ${field.name}`),
      ...checks.map(c => h('label', { for: `tag-${c.o}` }, c.cb, ` ${c.o}`)),
      h('div', { class: 'actions' }, h('button', { class: 'pill quiet', onclick: close }, 'Cancel'), apply));
  });
}

function openAddField(state: State): void {
  openDialog((container, close) => {
    const name = h('input', { 'aria-label': 'Field name' }) as HTMLInputElement;
    const type = h('select', { 'aria-label': 'Field type' }) as HTMLSelectElement;
    for (const t of ['text', 'number', 'date', 'single_select', 'multi_select', 'formula']) {
      type.append(h('option', { value: t }, t));
    }
    const opts = h('input', { 'aria-label': 'Options' }) as HTMLInputElement;
    opts.placeholder = 'Comma separated';
    const add = h('button', {
      class: 'pill primary', onclick: async () => {
        const payload: Record<string, unknown> = { name: name.value.trim(), type: type.value };
        if (opts.value.trim()) payload.options = opts.value.split(',').map(s => s.trim()).filter(Boolean);
        await api('POST', `/api/projects/${state.project!.id}/fields`, payload);
        window.location.reload();
      },
    }, 'Add field');
    container.append(h('h2', {}, 'Add field'),
      h('div', { class: 'field' }, h('label', {}, 'Field name'), name),
      h('div', { class: 'field' }, h('label', {}, 'Field type'), type),
      h('div', { class: 'field' }, h('label', {}, 'Options'), opts),
      h('div', { class: 'actions' }, h('button', { class: 'pill quiet', onclick: close }, 'Cancel'), add));
  });
}

function openFormulaEditor(field: FieldRecord, state: State): void {
  let opener = document.activeElement as HTMLElement | null;
  openDialog((container, close) => {
    const input = h('input', { 'aria-label': 'Formula' }) as HTMLInputElement;
    input.value = field.formula ?? '';
    const alert = h('div', { role: 'alert', class: 'err' });
    const save = h('button', {
      class: 'pill primary', onclick: async () => {
        const r = await api('PATCH', `/api/fields/${field.id}`, { formula: input.value });
        if (r.status === 422 && r.data.errors?.formula) {
          alert.textContent = r.data.errors.formula;
          return;
        }
        close();
        window.location.reload();
      },
    }, 'Save formula');
    container.append(h('h2', {}, `Edit formula: ${field.name}`),
      h('div', { class: 'field' }, h('label', {}, 'Formula'), input),
      alert,
      h('div', { class: 'actions' }, h('button', { class: 'pill quiet', onclick: close }, 'Cancel'), save));
    input.addEventListener('input', () => {
      if (input.value.endsWith('{')) {
        const list = h('div', { role: 'listbox', 'aria-label': 'Field suggestions' });
        const names = ['Start', 'Due', 'Effort', ...state.project!.fields.filter(f => f.type !== 'formula').map(f => f.name)];
        names.forEach((n, i) => {
          const opt = h('div', { role: 'option', 'aria-selected': String(i === 0), tabindex: '-1' }, `{${n}}`);
          opt.addEventListener('click', () => {
            input.value = input.value.slice(0, -1) + `{${n}}`;
            clear(list);
            input.focus();
          });
          list.append(opt);
        });
        if (!container.contains(container.querySelector('[role="listbox"]'))) {
          container.insertBefore(list, alert);
        }
      }
    });
  }, opener);
}

function confirmDelete(name: string, onDelete: () => Promise<void>, opener: HTMLElement | null): void {
  openDialog((container, close) => {
    container.append(h('h2', {}, name),
      h('p', {}, 'This cannot be undone.'),
      h('div', { class: 'actions' },
        h('button', { class: 'pill primary', onclick: async () => { await onDelete(); close(); window.location.reload(); } }, 'Delete'),
        h('button', { class: 'pill quiet', onclick: close }, 'Cancel')));
  }, opener);
}

/* ---------- task detail ---------- */

async function openDetail(task: Task, state: State): Promise<void> {
  const detail = await api<TaskDetail>('GET', `/api/tasks/${task.id}`);
  if (!detail.ok) return;
  const opener = document.activeElement as HTMLElement | null;
  const wide = window.innerWidth >= 1280;
  const sheet = h('div', { class: `sheet ${wide ? 'right' : 'bottom'}`, role: 'dialog', 'aria-modal': 'true' });
  sheet.setAttribute('aria-label', `Task: ${detail.data.name}`);
  document.body.append(sheet);

  const close = (): void => {
    document.removeEventListener('keydown', escHandler, true);
    sheet.remove();
    if (opener && document.contains(opener)) opener.focus();
  };
  const escHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  document.addEventListener('keydown', escHandler, true);

  const head = h('div', { class: 'sheet-head' },
    h('h2', {}, detail.data.name),
    h('button', { class: 'pill quiet', onclick: close, 'aria-label': 'Close task' }, 'Close task'));
  const bodyEl = h('div', { class: 'sheet-body detail' });
  sheet.append(head, bodyEl);

  const fields = state.project!.fields;
  const members = state.project!.members;
  const nameInput = h('input', { 'aria-label': 'Name', value: detail.data.name }) as HTMLInputElement;
  const nameErr = h('div', { class: 'err' });
  const descInput = h('textarea', { 'aria-label': 'Description' }) as HTMLTextAreaElement;
  descInput.value = detail.data.description;
  const statusLine = h('div', { role: 'status', 'aria-live': 'polite', id: 'Approval status' });

  const saveName = h('button', {
    class: 'pill outline', 'aria-label': 'Save name', onclick: async () => {
      await api('POST', `/api/tasks/${task.id}/hold`, { field: 'name' });
      const r = await api<Task>('PATCH', `/api/tasks/${task.id}`, { version: detail.data.version, name: nameInput.value });
      if (r.status === 409 && r.data.error === 'stale_task') { staleDialog(detail.data, nameInput.value, 'name'); return; }
      if (r.status === 422) { nameErr.textContent = 'Enter a task name'; return; }
      nameErr.textContent = '';
      detail.data.version = r.data.version;
      detail.data.name = r.data.name;
      toastHost().show('Saved');
      await api('DELETE', `/api/tasks/${task.id}/hold`, { field: 'name' });
    },
  }, 'Save name');

  const saveDesc = h('button', {
    class: 'pill outline', 'aria-label': 'Save description', onclick: async () => {
      await api('POST', `/api/tasks/${task.id}/hold`, { field: 'description' });
      const r = await api<Task>('PATCH', `/api/tasks/${task.id}`, { version: detail.data.version, description: descInput.value });
      if (r.status === 409 && r.data.error === 'stale_task') { staleDialog(detail.data, descInput.value, 'description'); return; }
      detail.data.version = r.data.version;
      toastHost().show('Saved');
      await api('DELETE', `/api/tasks/${task.id}/hold`, { field: 'description' });
    },
  }, 'Save description');

  function staleDialog(d: TaskDetail, text: string, field: 'name' | 'description'): void {
    openDialog((container, close) => {
      container.append(h('h2', {}, 'This task changed'),
        h('p', {}, 'Someone saved this task after you opened it.'),
        h('div', { class: 'actions' },
          h('button', {
            class: 'pill primary', onclick: async () => {
              const fresh = await api<TaskDetail>('GET', `/api/tasks/${task.id}`);
              if (field === 'name') nameInput.value = fresh.data.name;
              else descInput.value = fresh.data.description;
              detail.data.version = fresh.data.version;
              close();
            },
          }, 'Load latest'),
          h('button', {
            class: 'pill outline', onclick: async () => {
              const r = await api<Task>('PATCH', `/api/tasks/${task.id}`, { version: detail.data.version + 1, [field]: text });
              void r;
              close();
            },
          }, 'Keep my edit')));
    }, null);
  }

  const assignee = h('select', { 'aria-label': 'Assignee' }) as HTMLSelectElement;
  assignee.append(h('option', { value: '' }, 'Unassigned'));
  for (const m of members) assignee.append(h('option', { value: m.id }, m.name));
  assignee.value = detail.data.assigneeId ?? '';
  assignee.addEventListener('change', async () => {
    const r = await api<Task>('PATCH', `/api/tasks/${task.id}`, { version: detail.data.version, assigneeId: assignee.value || null });
    if (r.ok) detail.data.version = r.data.version;
    toastHost().show('Saved');
  });

  const mkDate = (label: string, key: 'start' | 'due'): HTMLInputElement => {
    const i = h('input', { type: 'date', 'aria-label': label }) as HTMLInputElement;
    i.value = detail.data[key] ?? '';
    i.addEventListener('change', async () => {
      const r = await api<Task>('PATCH', `/api/tasks/${task.id}`, { version: detail.data.version, [key]: i.value || null });
      if (r.ok) { detail.data.version = r.data.version; toastHost().show('Saved'); }
      else if (r.status === 422) { toastHost().show("Couldn't save. Nothing changed."); }
    });
    return i;
  };
  const startIn = mkDate('Start', 'start');
  const dueIn = mkDate('Due', 'due');
  const effortIn = h('input', { type: 'number', 'aria-label': 'Effort', min: '0', step: '0.5' }) as HTMLInputElement;
  effortIn.value = detail.data.effort === null ? '' : String(detail.data.effort);
  effortIn.addEventListener('change', async () => {
    const r = await api<Task>('PATCH', `/api/tasks/${task.id}`, { version: detail.data.version, effort: effortIn.value === '' ? null : Number(effortIn.value) });
    if (r.ok) { detail.data.version = r.data.version; toastHost().show('Saved'); }
  });

  const approvalChip = h('span', { class: 'chipstatus' }, APPROVAL_TEXT[detail.data.approval.status] ?? 'None');
  const approverSel = h('select', { 'aria-label': 'Approver' }) as HTMLSelectElement;
  for (const m of members) approverSel.append(h('option', { value: m.id }, m.name));
  const requestApproval = h('button', {
    class: 'pill outline', onclick: async () => {
      const r = await api('POST', `/api/tasks/${task.id}/approval`, { approverId: approverSel.value });
      if (r.ok) { approvalChip.textContent = 'Awaiting approval'; statusLine.textContent = 'Approval requested'; }
    },
  }, 'Request approval');

  const viewing = h('ul', { class: 'list', 'aria-label': 'Viewing now' });
  const runsList = h('ul', { class: 'list', 'aria-label': 'Rule runs' });
  const historyList = h('ul', { class: 'list', 'aria-label': 'History' });
  const attachList = h('ul', { class: 'list', 'aria-label': 'Attachments' });

  const refreshRuns = async (): Promise<void> => {
    const runs = await api<{ runs: { id: string; depth: number; summary: string; detail: string; createdAt: string }[] }>('GET', `/api/tasks/${task.id}/rule-runs`);
    clear(runsList);
    for (const r of runs.data.runs ?? []) {
      const row = h('li', { class: 'runrow', 'data-depth': String(r.depth), 'data-motion': 'entering' },
        h('div', { 'data-part': 'summary', class: 'sum' }, r.summary),
        h('div', { 'data-part': 'detail', class: 'det' }, r.detail));
      row.style.paddingLeft = `${r.depth * 16}px`;
      runsList.append(row);
      animateRunEntry(row);
    }
  };
  void refreshRuns();

  for (const v of detail.data.viewing) viewing.append(h('li', {}, v.name));
  for (const hist of detail.data.history) historyList.append(h('li', {}, hist.text));
  for (const a of detail.data.attachments) attachList.append(h('li', {}, h('a', { href: `/api/attachments/${a.id}` }, a.name), ` (${a.size} bytes)`));

  const attachAlert = h('div', { role: 'alert' });
  const fileInput = h('input', { type: 'file', class: 'visually-hidden' }) as HTMLInputElement;
  const attachBtn = h('button', {
    class: 'pill outline', onclick: () => fileInput.click(),
  }, 'Attach file');
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    const res = await fetch(`/api/tasks/${task.id}/attachments`, { method: 'POST', body: fd });
    if (res.status === 413) { attachAlert.textContent = 'File is larger than 1 MB'; return; }
    if (res.status === 503) {
      attachAlert.textContent = 'Attachment failed: file storage is unavailable. Nothing was saved.';
      outageBand(document.body, true);
      return;
    }
    if (res.ok) {
      const saved = await res.json() as { id: string; name: string; size: number };
      attachList.append(h('li', {}, h('a', { href: `/api/attachments/${saved.id}` }, saved.name), ` (${saved.size} bytes)`));
      attachAlert.textContent = '';
      outageBand(document.body, false);
    }
  });

  const deleteBtn = h('button', {
    class: 'pill outline', onclick: () => {
      confirmDelete(`Delete ${detail.data.name}?`, async () => {
        await api('DELETE', `/api/tasks/${task.id}`);
        announce('List status', 'Task deleted');
        close();
        window.location.reload();
      }, null);
    },
  }, 'Delete task');

  const fieldsBlock = h('div', { class: 'fields' },
    h('div', { class: 'field' }, h('label', {}, 'Name'), nameInput, nameErr, saveName),
    h('div', { class: 'field' }, h('label', {}, 'Description'), descInput, saveDesc),
    h('div', { class: 'rowfield' }, h('span', {}, 'Assignee'), assignee),
    h('div', { class: 'rowfield' }, h('span', {}, 'Start'), startIn),
    h('div', { class: 'rowfield' }, h('span', {}, 'Due'), dueIn),
    h('div', { class: 'rowfield' }, h('span', {}, 'Effort'), effortIn),
    h('div', { class: 'row' }, approvalChip, approverSel, requestApproval),
    statusLine,
    h('div', {}, h('h3', { class: 'h5' }, 'Viewing now'), viewing),
    h('div', {}, h('h3', { class: 'h5' }, 'Rule runs'), runsList),
    h('div', {}, h('h3', { class: 'h5' }, 'History'), historyList),
    h('div', {}, h('h3', { class: 'h5' }, 'Attachments'), attachAlert, attachList, attachBtn, fileInput),
    h('div', {}, deleteBtn));

  bodyEl.append(fieldsBlock);
  const first = sheet.querySelector<HTMLElement>('input, button, select, textarea');
  if (first) focusBelowBar(first);
}

/* ---------- board view ---------- */

function renderBoard(body: HTMLElement, state: State): void {
  const proj = state.project!;
  const board = h('div', { class: 'board' });
  const sections = [...proj.sections].sort((a, b) => a.position - b.position);
  let picked: { taskId: string; el: HTMLElement } | null = null;

  for (const section of sections) {
    const cards = state.tasks.filter(t => t.section === section.id && !t.parentId);
    const col = h('div', { class: 'col', role: 'group', 'aria-label': section.name });
    col.append(h('h3', {}, section.name));
    cards.forEach((task, i) => {
      const card = h('div', {
        class: 'boardcard', role: 'button', tabindex: '0',
        'data-task': task.id, 'data-section': section.id, 'data-position': String(i + 1),
        'data-move-progress': '1.0000', 'data-motion': 'settled',
        'aria-label': `${task.name}, ${section.name}, position ${i + 1} of ${cards.length}`,
      }, h('div', {}, task.name), h('div', { class: 'pos num' }, `position ${i + 1} of ${cards.length}`));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); openDetail(task, state); return; }
        if (e.key === ' ') {
          e.preventDefault();
          if (picked?.el === card) {
            void dropPicked();
          } else {
            picked = { taskId: task.id, el: card };
            card.classList.add('picked');
            announce('Board status', `Picked up ${task.name}. ${section.name}, position ${i + 1} of ${cards.length}.`, 'assertive');
          }
          return;
        }
        if (e.key === 'Escape' && picked?.el === card) {
          e.preventDefault();
          picked = null;
          card.classList.remove('picked');
          announce('Board status', `Move cancelled. ${task.name} is back in ${section.name}, position ${i + 1} of ${cards.length}.`, 'assertive');
          return;
        }
        if (!picked || picked.el !== card) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const si = sections.findIndex(s => s.id === section.id);
          const target = sections[si + (e.key === 'ArrowRight' ? 1 : -1)];
          if (!target) return;
          const targetCards = state.tasks.filter(t => t.section === target.id && !t.parentId);
          const pos = Math.min(task.position, targetCards.length + 1);
          announce('Board status', `${task.name}, ${target.name}, position ${pos} of ${targetCards.length + 1}.`, 'assertive');
          void moveCard(task, target.id, pos, state, card);
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const pos = Math.max(1, Math.min(cards.length, task.position + (e.key === 'ArrowDown' ? 1 : -1)));
          announce('Board status', `${task.name}, ${section.name}, position ${pos} of ${cards.length}.`, 'assertive');
          void moveCard(task, section.id, pos, state, card);
          return;
        }
      });
      col.append(card);
    });
    board.append(col);
  }

  const dropPicked = async (): Promise<void> => {
    if (!picked) return;
    const task = state.tasks.find(t => t.id === picked!.taskId);
    picked = null;
    if (task) {
      announce('Board status', `Dropped ${task.name} in place.`, 'assertive');
    }
  };

  body.append(board);
}

async function moveCard(task: Task, section: string, position: number, state: State, card: HTMLElement): Promise<void> {
  const r = await api<Task>('PATCH', `/api/tasks/${task.id}`, { version: task.version, section, position });
  if (!r.ok) { toastHost().show("Couldn't save. Nothing changed."); return; }
  animateMove(card, () => {
    const i = state.tasks.findIndex(t => t.id === task.id);
    if (i >= 0) state.tasks[i] = r.data;
    state.tasks.sort(taskOrder);
    rerenderHook?.();
  });
}

/* ---------- timeline view ---------- */

function renderTimeline(body: HTMLElement, state: State): void {
  const proj = state.project!;
  const scheduled = state.tasks.filter(t => !t.parentId && (t.start || t.due));
  const unscheduled = state.tasks.filter(t => !t.parentId && !t.start && !t.due);
  const dated = state.tasks.filter(t => !t.parentId && (t.start || t.due));
  const starts = dated.map(t => t.start ?? t.due!).filter(Boolean);
  const ends = dated.map(t => t.due ?? t.start!).filter(Boolean);
  const min = starts.length ? starts.reduce((a, b) => a < b ? a : b) : '2026-03-02';
  const max = ends.length ? ends.reduce((a, b) => a > b ? a : b) : '2026-03-16';
  const days: string[] = [];
  const dayCount = Math.max(14, diffDays(min, max) + 3);
  for (let i = 0; i < dayCount; i++) days.push(addDaysY(min, i));

  const wrap = h('div', { class: 'timeline' });
  const head = h('div', { class: 'tl-head' });
  for (const d of days) head.append(h('span', {}, d.slice(8)));
  wrap.append(head);

  let depMode: string | null = null;

  for (const task of scheduled) {
    const start = task.start ?? task.due!;
    const due = task.due ?? task.start!;
    const span = Math.max(1, diffDays(start, due) + 1);
    const bar = h('button', {
      class: 'tl-bar', 'data-task': task.id, 'data-start': start, 'data-due': due,
      'data-move-progress': '1.0000', 'data-motion': 'settled',
      'aria-label': `${task.name}, ${start} to ${due}`,
      style: `left:${diffDays(min, start) * 32}px;width:${span * 32 - 6}px`,
    }, `${task.name} ${start} to ${due}`);
    bar.addEventListener('keydown', e => {
      if (depMode) {
        if (e.key === 'Enter') {
          e.preventDefault();
          void api('POST', `/api/tasks/${depMode}/dependencies`, { blocks: task.id }).then(r => {
            if (r.ok) announce('Timeline status', `Now blocks ${task.name}`);
          });
          depMode = null;
          return;
        }
        if (e.key === 'Escape') { e.preventDefault(); depMode = null; announce('Timeline status', 'Dependency cancelled'); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const bars = Array.from(document.querySelectorAll<HTMLElement>('.tl-bar'));
          const i = bars.indexOf(bar);
          (bars[i + (e.key === 'ArrowDown' ? 1 : -1)] ?? bar).focus();
          return;
        }
        return;
      }
      if (e.key === 'Enter') { e.preventDefault(); openDetail(task, state); return; }
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        depMode = task.id;
        announce('Timeline status', `Choose the task that waits for ${task.name}`);
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (e.shiftKey) {
          const newDue = addDaysY(due, dir);
          if (newDue < start) { announce('Timeline status', "Due date can't be before the start date"); return; }
          announce('Timeline status', `${task.name} now due ${newDue}`);
          animateMove(bar, () => {
            bar.setAttribute('data-due', newDue);
            const span2 = Math.max(1, diffDays(start, newDue) + 1);
            bar.style.width = `${span2 * 32 - 6}px`;
            bar.textContent = `${task.name} ${start} to ${newDue}`;
          });
          void api<Task>('PATCH', `/api/tasks/${task.id}`, { version: task.version, due: newDue }).then(r => {
            if (r.ok) { const i = state.tasks.findIndex(t => t.id === task.id); if (i >= 0) state.tasks[i] = r.data; }
          });
          return;
        }
        const newStart = addDaysY(start, dir);
        const newDue = addDaysY(due, dir);
        announce('Timeline status', `${task.name} moved to ${newStart} to ${newDue}`);
        animateMove(bar, () => {
          bar.style.left = `${diffDays(min, newStart) * 32}px`;
          bar.setAttribute('data-start', newStart);
          bar.setAttribute('data-due', newDue);
          bar.setAttribute('aria-label', `${task.name}, ${newStart} to ${newDue}`);
          bar.textContent = `${task.name} ${newStart} to ${newDue}`;
        });
        void api<Task>('PATCH', `/api/tasks/${task.id}`, { version: task.version, start: newStart, due: newDue }).then(r => {
          if (r.ok) { const i = state.tasks.findIndex(t => t.id === task.id); if (i >= 0) state.tasks[i] = r.data; }
        });
        return;
      }
    });
    wrap.append(h('div', { class: 'tl-row' }, bar));
  }

  if (unscheduled.length > 0) {
    body.append(h('div', {}, h('h3', { class: 'h5' }, 'Unscheduled'),
      h('ul', { style: 'list-style:none;padding:0' }, ...unscheduled.map(t => h('li', {}, t.name)))));
  }
  body.append(wrap);
  void proj;
}

function diffDays(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000);
}

/** The pink-to-coral line through the tasks the last rule run changed. */
function drawTrace(body: HTMLElement, state: State): void {
  document.querySelectorAll('.traceimg').forEach(x => x.remove());
  if (!state.trace || state.trace.length === 0) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'traceimg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Rule trace');
  svg.style.position = 'fixed';
  svg.style.inset = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '30';
  const points = state.trace
    .map(id => document.querySelector<HTMLElement>(`[data-task="${id}"]`))
    .filter((x): x is HTMLElement => x !== null);
  if (points.length === 0) { document.body.append(svg); return; }
  let d = '';
  points.forEach((p, i) => {
    const r = p.getBoundingClientRect();
    const x = r.left - 8;
    const y = r.top + r.height / 2;
    d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', String(x));
    dot.setAttribute('cy', String(y));
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', '#17181a');
    svg.append(dot);
  });
  if (points.length === 1) {
    const r = points[0].getBoundingClientRect();
    d += ` L ${r.left - 8} ${r.top + r.height / 2}`;
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('stroke', 'url(#trace-grad)');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('fill', 'none');
  svg.append(path);
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  grad.setAttribute('id', 'trace-grad');
  const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  s1.setAttribute('offset', '0');
  s1.setAttribute('stop-color', '#f6b8ac');
  const s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  s2.setAttribute('offset', '1');
  s2.setAttribute('stop-color', '#e2554a');
  grad.append(s1, s2);
  defs.append(grad);
  svg.prepend(defs);
  document.body.append(svg);
  void body;
}

function addDaysY(d: string, n: number): string {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export { esc };
