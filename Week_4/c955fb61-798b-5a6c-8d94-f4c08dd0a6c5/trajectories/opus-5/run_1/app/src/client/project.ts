import { append, clear, h } from './dom.js';
import { bus } from './bus.js';
import { canEdit, state, type ViewName } from './state.js';
import { api } from './api.js';
import { renderGantt, isPhone } from './gantt.js';
import { listFocusKey, renderList } from './list.js';
import { renderWorkload } from './workload.js';
import { closeOpenDialog, openBaselineDialog, openHolidaysDialog, openTaskDetails, pushCommentToOpenDialog } from './dialogs.js';
import { ActionFailure, createExport } from './actions.js';
import { closeLiveChannel, openLiveChannel } from './live.js';
import { paintMotion, startKnockOn } from './motion.js';
import { finishText } from './sentences.js';
import { ALERTS, criticalCountText, varianceText } from '../shared/copy.js';
import { mondayOf } from '../shared/dates.js';
import { prefersReducedMotion } from './dom.js';
import type { ExportRecord, Project, WorkloadResponse } from '../shared/types.js';

interface Shell {
  finish: HTMLElement;
  variance: HTMLElement;
  criticalCount: HTMLElement;
  people: HTMLElement;
  tabs: Map<ViewName, HTMLElement>;
  toolbar: HTMLElement;
  scheduleStatus: HTMLElement;
  projectStatus: HTMLElement;
  exportStatus: HTMLElement;
  alert: HTMLElement;
  viewHost: HTMLElement;
  exports: HTMLElement;
  baselineBox: HTMLInputElement;
  criticalBox: HTMLInputElement;
}

let shell: Shell | null = null;

const VIEWS: ViewName[] = ['gantt', 'list', 'workload'];
const VIEW_LABELS: Record<ViewName, string> = { gantt: 'Gantt', list: 'List', workload: 'Workload' };

function writeUrl(): void {
  const url = new URL(location.href);
  url.searchParams.set('view', state.view);
  if (state.showBaseline) url.searchParams.set('baseline', 'on');
  else url.searchParams.delete('baseline');
  if (state.highlightCritical) url.searchParams.set('critical', 'on');
  else url.searchParams.delete('critical');
  if (state.view === 'workload') url.searchParams.set('from', state.workloadFrom);
  else url.searchParams.delete('from');
  url.searchParams.delete('task');
  history.replaceState(null, '', url.toString());
}

function renderPeople(): void {
  if (!shell) return;
  clear(shell.people);
  const me = state.me!;
  const others = state.presence
    .filter((person) => person.userId !== me.id)
    .map((person) => person.name)
    .sort();
  append(shell.people, [
    h('li', { role: 'listitem', text: `${me.name} (you)` }),
    ...others.map((name) => h('li', { role: 'listitem', text: name })),
  ]);
}

function renderExports(): void {
  if (!shell) return;
  clear(shell.exports);
  shell.exports.appendChild(h('h2', { text: 'Exports' }));
  const list = h('ul', { role: 'list', class: 'plain-list export-list' });
  state.exports.forEach((record: ExportRecord, index) => {
    const entry = h('li', { role: 'listitem' }, [
      h('a', {
        href: record.downloadUrl,
        text: `Download ${record.filename}`,
        download: record.filename,
        'data-focus-key': `export:${record.id}`,
      }),
      h('span', {
        class: 'export-meta',
        text: ` ${record.format.toUpperCase()} ${new Date(record.createdAt).toISOString().slice(11, 16)}`,
      }),
      index === 0 ? h('span', { class: 'ready-tag', text: 'Ready' }) : null,
    ]);
    list.appendChild(entry);
  });
  shell.exports.appendChild(list);
}

function renderView(): void {
  if (!shell) return;
  const host = shell.viewHost;
  const active = document.activeElement as HTMLElement | null;
  let focusKey = active && host.contains(active) ? (active.dataset.focusKey ?? null) : null;
  // The grids move their active cell as part of an edit, so focus follows the cell, not the node.
  if (focusKey?.startsWith('cell:')) focusKey = listFocusKey();
  if (focusKey?.startsWith('wl:')) {
    focusKey = `wl:${state.activeWorkloadCell.person}:${state.activeWorkloadCell.day}`;
  }
  const scroller = host.querySelector<HTMLElement>('[data-scroll]');
  const scrollLeft = scroller?.scrollLeft ?? 0;
  const scrollTop = scroller?.scrollTop ?? 0;

  if (state.view === 'gantt') renderGantt(host);
  else if (state.view === 'list') renderList(host);
  else renderWorkload(host);

  const nextScroller = host.querySelector<HTMLElement>('[data-scroll]');
  if (nextScroller) {
    nextScroller.scrollLeft = scrollLeft;
    nextScroller.scrollTop = scrollTop;
  }
  if (focusKey) {
    const target = host.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`);
    const editor = target?.querySelector<HTMLInputElement>('input');
    if (editor) {
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
    } else target?.focus({ preventScroll: true });
  }
}

function update(): void {
  if (!shell || !state.project) return;
  const project = state.project;
  shell.finish.textContent = finishText(project.finish);
  if (project.baseline && project.baseline.finishVariance !== null) {
    shell.variance.textContent = varianceText(project.baseline.finishVariance);
    shell.finish.after(shell.variance);
  } else {
    shell.variance.remove();
  }
  shell.criticalCount.textContent = criticalCountText(
    project.items.filter((item) => item.kind !== 'group' && item.critical).length,
  );
  document.documentElement.dataset.view = state.view;
  for (const [name, tab] of shell.tabs) {
    tab.setAttribute('aria-selected', name === state.view ? 'true' : 'false');
    tab.tabIndex = name === state.view ? 0 : -1;
  }
  shell.baselineBox.checked = state.showBaseline;
  shell.criticalBox.checked = state.highlightCritical;
  shell.alert.textContent = state.pageAlert ?? '';
  document.body.classList.toggle('reduced-motion', prefersReducedMotion());
  renderPeople();
  renderExports();
  renderView();
  // A redraw replaces the bars, so the frame the knock-on is on is put back at once.
  paintMotion();
  writeUrl();
}

function announce(region: HTMLElement, text: string): void {
  region.textContent = text;
}

function buildExportMenu(button: HTMLElement): HTMLElement {
  const menu = h('div', { role: 'menu', 'aria-label': 'Export', class: 'menu', hidden: true });
  const items: HTMLElement[] = [];
  for (const format of ['csv', 'pdf'] as const) {
    const item = h('button', {
      type: 'button',
      role: 'menuitem',
      text: `Export ${format.toUpperCase()}`,
      tabindex: '-1',
    });
    item.addEventListener('click', () => {
      closeMenu();
      void createExport(format).catch((error: ActionFailure) => bus.setAlert(error.text));
    });
    items.push(item);
    menu.appendChild(item);
  }

  const openMenu = (): void => {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    items[0].focus();
  };
  const closeMenu = (): void => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.focus();
  };
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-haspopup', 'menu');
  button.addEventListener('click', () => {
    if (menu.hidden) openMenu();
    else closeMenu();
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openMenu();
    }
  });
  menu.addEventListener('keydown', (event) => {
    const index = items.indexOf(event.target as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[Math.min(index + 1, items.length - 1)].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[Math.max(index - 1, 0)].focus();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      closeMenu();
    }
  });
  return menu;
}

function buildShell(root: HTMLElement, project: Project): Shell {
  clear(root);
  const heading = h('h1', { text: project.name });
  const finish = h('p', { id: 'project-finish' });
  const variance = h('p', { id: 'finish-variance' });
  const criticalCount = h('p', { id: 'critical-count' });
  const people = h('ul', { role: 'list', 'aria-label': 'People here', class: 'people' });

  const tablist = h('div', { role: 'tablist', 'aria-label': 'View', class: 'tablist' });
  const tabs = new Map<ViewName, HTMLElement>();
  VIEWS.forEach((name) => {
    const tab = h('button', {
      type: 'button',
      role: 'tab',
      text: VIEW_LABELS[name],
      'aria-selected': 'false',
      tabindex: '-1',
    });
    tab.addEventListener('click', () => selectView(name));
    tabs.set(name, tab);
    tablist.appendChild(tab);
  });
  tablist.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = VIEWS.indexOf(state.view);
    const next = VIEWS[(index + (event.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length];
    selectView(next);
    tabs.get(next)?.focus();
  });

  const baselineBox = h('input', { type: 'checkbox', id: 'show-baseline' }) as HTMLInputElement;
  baselineBox.addEventListener('change', () => {
    state.showBaseline = baselineBox.checked;
    update();
  });
  const criticalBox = h('input', { type: 'checkbox', id: 'highlight-critical' }) as HTMLInputElement;
  criticalBox.addEventListener('change', () => {
    state.highlightCritical = criticalBox.checked;
    update();
  });

  const baselineButton = h('button', { type: 'button', text: 'Save baseline' });
  baselineButton.addEventListener('click', () => {
    if (!canEdit()) {
      bus.setAlert(ALERTS.readOnly);
      return;
    }
    openBaselineDialog(baselineButton);
  });
  const holidaysButton = h('button', { type: 'button', text: 'Holidays' });
  holidaysButton.addEventListener('click', () => {
    if (!canEdit()) {
      bus.setAlert(ALERTS.readOnly);
      return;
    }
    openHolidaysDialog(holidaysButton);
  });
  if (!canEdit()) {
    baselineButton.setAttribute('aria-disabled', 'true');
    holidaysButton.setAttribute('aria-disabled', 'true');
  }
  const exportButton = h('button', { type: 'button', text: 'Export' });
  const exportMenu = buildExportMenu(exportButton);

  const toolbar = h('div', { class: 'toolbar' }, [
    h('span', { class: 'check' }, [baselineBox, h('label', { for: 'show-baseline', text: 'Show baseline' })]),
    h('span', { class: 'check' }, [
      criticalBox,
      h('label', { for: 'highlight-critical', text: 'Highlight critical path' }),
    ]),
    baselineButton,
    holidaysButton,
    h('span', { class: 'export-wrap' }, [exportButton, exportMenu]),
  ]);

  const scheduleStatus = h('div', { role: 'status', 'aria-label': 'Schedule updates', 'aria-live': 'polite' });
  const projectStatus = h('div', { role: 'status', 'aria-label': 'Project updates', 'aria-live': 'polite' });
  const exportStatus = h('div', { role: 'status', 'aria-label': 'Export status', 'aria-live': 'polite' });
  const alert = h('div', { role: 'alert', class: 'page-alert' });
  const viewHost = h('div', { class: 'view-host' });
  const exports = h('section', { role: 'region', 'aria-label': 'Exports', class: 'exports' });

  const main = h('main', {});
  append(main, [
    h('header', { class: 'project-header' }, [
      h('div', { class: 'header-main' }, [heading, finish, criticalCount]),
      people,
    ]),
    tablist,
    toolbar,
    h('div', { class: 'status-area' }, [scheduleStatus, projectStatus, alert]),
    viewHost,
    exportStatus,
    exports,
  ]);
  root.appendChild(main);

  return {
    finish,
    variance,
    criticalCount,
    people,
    tabs,
    toolbar,
    scheduleStatus,
    projectStatus,
    exportStatus,
    alert,
    viewHost,
    exports,
    baselineBox,
    criticalBox,
  };
}

function selectView(name: ViewName): void {
  state.view = name;
  if (name === 'workload') void loadWorkload();
  update();
}

async function loadWorkload(): Promise<void> {
  const answer = await api.get<WorkloadResponse>(
    `/api/workspaces/${state.workspaceId}/workload?from=${state.workloadFrom}`,
  );
  state.workload = answer;
  update();
}

function shiftedBetween(previous: Project | null, next: Project): Set<string> {
  const shifted = new Set<string>();
  if (!previous) return shifted;
  const before = new Map(previous.items.map((item) => [item.id, item]));
  for (const item of next.items) {
    const old = before.get(item.id);
    if (old && (old.start !== item.start || old.end !== item.end)) shifted.add(item.id);
  }
  return shifted;
}

export async function mountProjectPage(root: HTMLElement, projectId: string): Promise<void> {
  const url = new URL(location.href);
  const requestedView = url.searchParams.get('view');
  state.view = VIEWS.includes(requestedView as ViewName) ? (requestedView as ViewName) : 'gantt';
  state.showBaseline = url.searchParams.get('baseline') === 'on';
  state.highlightCritical = url.searchParams.get('critical') === 'on';
  state.workloadFrom = url.searchParams.get('from') ?? mondayOf(state.config.today);
  const openTask = url.searchParams.get('task');

  let project: Project;
  try {
    project = await api.get<Project>(`/api/projects/${projectId}`);
  } catch {
    clear(root);
    root.appendChild(h('h1', { text: 'No such project.' }));
    return;
  }

  const me = await api.get<{ workspaces: { id: string; role: string }[] }>('/api/me');
  const projects = await api.get<{ projects: { id: string; workspace: { id: string } }[] }>('/api/projects');
  const entry = projects.projects.find((candidate) => candidate.id === projectId)!;
  state.workspaceId = entry.workspace.id;
  state.role = (me.workspaces.find((workspace) => workspace.id === entry.workspace.id)?.role ??
    'viewer') as typeof state.role;
  state.project = project;
  state.previousProject = null;
  state.shifted = new Set();
  // The Task list starts on row 1's Name cell, or the `Add task` row's in an empty project.
  state.activeCell = { itemId: project.items[0]?.id ?? null, column: 2 };

  shell = buildShell(root, project);
  bus.update = update;
  bus.announceSchedule = (text) => announce(shell!.scheduleStatus, text);
  bus.announceProject = (text) => announce(shell!.projectStatus, text);
  bus.announceExport = (text) => announce(shell!.exportStatus, text);
  bus.setAlert = (text) => {
    state.pageAlert = text;
    if (shell) shell.alert.textContent = text ?? '';
  };
  bus.reloadWorkload = () => {
    void loadWorkload();
  };

  state.exports = (await api.get<{ exports: ExportRecord[] }>(`/api/projects/${projectId}/exports`)).exports;
  await loadWorkload();
  update();

  openLiveChannel(
    projectId,
    (message) => {
      if (message.type === 'project') {
        state.previousProject = state.project;
        state.project = message.project;
        state.shifted = shiftedBetween(state.previousProject, message.project);
        // Draw the new places first, then start the slide from the old ones in the same frame.
        update();
        startKnockOn(state.previousProject, message.project, message.edit.editedItemId);
        if (message.edit.actorId !== state.me?.id) {
          const actor = message.edit.actorName;
          const name = message.edit.itemName ?? '';
          const sentence =
            message.edit.verb === 'added'
              ? `${actor} added ${name}.`
              : message.edit.verb === 'deleted'
                ? `${actor} deleted ${name}.`
                : message.edit.verb === 'holidays'
                  ? `${actor} changed the holidays.`
                  : message.edit.verb === 'baseline'
                    ? `${actor} saved the baseline.`
                    : `${actor} changed ${name}.`;
          bus.announceProject(sentence);
        }
      } else if (message.type === 'presence') {
        const next = JSON.stringify(message.people);
        if (next !== JSON.stringify(state.presence)) {
          state.presence = message.people;
          update();
        }
      } else if (message.type === 'comment') {
        pushCommentToOpenDialog(message.itemId, message.comment);
        if (message.actorId !== state.me?.id) {
          bus.announceProject(`${message.comment.author.name} commented on ${message.itemName}.`);
        }
      } else if (message.type === 'exports') {
        state.exports = message.exports;
        renderExports();
      } else {
        void loadWorkload();
      }
    },
    () => {
      void (async () => {
        state.project = await api.get<Project>(`/api/projects/${projectId}`);
        update();
      })();
    },
  );

  if (openTask) {
    const item = project.items.find((candidate) => candidate.id === openTask);
    const firstBar = project.items.find((candidate) => candidate.kind !== 'group');
    if (item) openTaskDetails(item, firstBar ? `bar:${firstBar.id}` : null);
  }

  let phone = isPhone();
  window.addEventListener('resize', () => {
    if (isPhone() !== phone) {
      phone = isPhone();
      update();
    }
  });
}

export function unmountProjectPage(): void {
  closeOpenDialog();
  closeLiveChannel();
  shell = null;
}
