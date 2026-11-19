import { api, ApiCallError, type Project, type RuleRun, type Task } from '../api.js';
import { openDialog } from '../dialog.js';
import { clear, el, on } from '../dom.js';
import { onLive } from '../live.js';
import { clearStorageOutage, showStorageOutage } from '../outage.js';
import { navigate } from '../router.js';
import { announce, statusRegion } from '../status.js';
import { viewport } from '../state.js';
import { internalLink } from '../topbar.js';
import { createBoardView } from '../views/board.js';
import { createListView } from '../views/list.js';
import { createTimelineView } from '../views/timeline.js';
import { openDetail, type DetailPanel } from '../views/detail.js';
import {
  sortTasks,
  takePendingFocus,
  type ProjectContext,
  type View,
} from '../views/shared.js';

type ViewName = 'list' | 'board' | 'timeline';

const VIEW_LABEL: Record<ViewName, string> = {
  list: 'List',
  board: 'Board',
  timeline: 'Timeline',
};

export function projectNotFound(main: HTMLElement): void {
  main.className = 'page page--empty';
  const back = el('button', { type: 'button', class: 'pill pill--dark' }, 'Back to My work');
  on(back, 'click', () => navigate('/'));
  main.append(
    el('div', { class: 'empty' }, [
      el('h1', { class: 'page__title' }, 'Project not found'),
      el('p', { class: 'empty__sentence' }, 'That project is not in your teams.'),
      back,
    ]),
  );
}

export async function renderProject(
  main: HTMLElement,
  projectId: string,
  search: URLSearchParams,
): Promise<void> {
  let project: Project;
  try {
    project = await api.get<Project>(`/api/projects/${projectId}`);
  } catch (err) {
    if (err instanceof ApiCallError && err.failure.status === 404) {
      projectNotFound(main);
      return;
    }
    throw err;
  }

  const requested = (search.get('view') ?? 'list') as ViewName;
  const viewName: ViewName = ['list', 'board', 'timeline'].includes(requested) ? requested : 'list';

  main.className = 'page page--project';
  const panelButton = el(
    'button',
    { type: 'button', class: 'pill pill--ghost', 'aria-expanded': 'false' },
    'Project panel',
  );
  const rail = el('div', { class: 'project-rail', hidden: true });
  const chipRow = el('div', {
    role: 'tablist',
    'aria-label': 'Project views',
    class: 'chip-row chip-row--views',
  });
  const extras = el('div', { class: 'chip-row chip-row--extras' });
  const viewHost = el('div', { class: 'view-host' });
  const detailHost = el('div', { class: 'detail-host' });

  const panelOpen = viewport() === 1280;
  rail.hidden = !panelOpen;
  panelButton.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
  on(panelButton, 'click', () => {
    const open = panelButton.getAttribute('aria-expanded') === 'true';
    panelButton.setAttribute('aria-expanded', open ? 'false' : 'true');
    rail.hidden = open;
  });

  const tasks: Task[] = [];
  const byId = new Map<string, Task>();
  let panel: DetailPanel | null = null;

  const context: ProjectContext = {
    project,
    tasks,
    byId,
    openTask: (taskId, opener) => {
      void openDetail({
        context,
        taskId,
        opener,
        host: detailHost,
        onClose: () => {
          panel = null;
        },
      }).then((opened) => {
        panel = opened;
      });
    },
  };

  const loadTasks = async () => {
    const data = await api.get<{ tasks: Task[]; total: number; pageSize: number }>(
      `/api/projects/${project.id}/tasks`,
    );
    const all = [...data.tasks];
    let page = 2;
    while (all.length < data.total) {
      const more = await api.get<{ tasks: Task[] }>(
        `/api/projects/${project.id}/tasks?page=${page}`,
      );
      if (more.tasks.length === 0) break;
      all.push(...more.tasks);
      page += 1;
    }
    tasks.length = 0;
    byId.clear();
    for (const task of sortTasks(all, project.sections)) {
      tasks.push(task);
      byId.set(task.id, task);
    }
  };

  await loadTasks();

  const views: Record<ViewName, () => View> = {
    list: () => createListView(context),
    board: () => createBoardView(context),
    timeline: () => createTimelineView(context),
  };
  let view: View = views[viewName]();
  let active: ViewName = viewName;
  viewHost.replaceChildren(view.node);

  const tabs: HTMLButtonElement[] = [];
  const selectView = (name: ViewName, push = true) => {
    active = name;
    view = views[name]();
    viewHost.replaceChildren(view.node);
    takePendingFocus(viewHost);
    tabs.forEach((tab) => {
      const selected = tab.dataset.view === name;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
      tab.classList.toggle('chip--active', selected);
    });
    if (push) {
      window.history.replaceState({}, '', `/projects/${project.id}?view=${name}`);
    }
  };

  (['list', 'board', 'timeline'] as ViewName[]).forEach((name, index) => {
    const tab = el(
      'button',
      {
        type: 'button',
        role: 'tab',
        'data-view': name,
        class: `chip${name === viewName ? ' chip--active' : ''}`,
        'aria-selected': name === viewName ? 'true' : 'false',
        tabindex: name === viewName ? 0 : -1,
      },
      VIEW_LABEL[name],
    );
    on(tab, 'click', () => selectView(name));
    on(tab, 'keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const order: ViewName[] = ['list', 'board', 'timeline'];
      const next = order[(index + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
      selectView(next);
      const target = tabs.find((candidate) => candidate.dataset.view === next);
      if (target) target.focus();
    });
    tabs.push(tab);
    chipRow.appendChild(tab);
  });

  const download = el('button', { type: 'button', class: 'pill pill--ghost' }, 'Download project');
  on(download, 'click', () => openDownload(project.id, download));
  extras.append(
    internalLink('Workload', `/workload/${project.teamId}`, 'pill pill--ghost'),
    internalLink('Rules', `/projects/${project.id}/rules`, 'pill pill--ghost'),
    download,
  );

  clear(rail);
  rail.append(
    el('h2', { class: 'project-rail__title' }, project.name),
    el(
      'ul',
      { class: 'project-rail__sections' },
      project.sections.map((section) => el('li', {}, section.name)),
    ),
  );

  main.append(
    el('header', { class: 'project__header' }, [
      el('h1', { class: 'page__title' }, project.name),
      panelButton,
    ]),
    statusRegion('List status'),
    statusRegion('Board status', true),
    statusRegion('Timeline status'),
    el('div', { class: 'project__layout' }, [
      rail,
      el('div', { class: 'project__main' }, [chipRow, extras, viewHost]),
      detailHost,
    ]),
  );

  const reloadProject = async () => {
    project = await api.get<Project>(`/api/projects/${project.id}`);
    context.project = project;
    await loadTasks();
    selectView(active, false);
  };

  const stop = onLive((event) => {
    if (event.projectId !== undefined && event.projectId !== project.id) {
      if (event.type !== 'goals_changed' && event.type !== 'workload_changed') return;
    }
    switch (event.type) {
      case 'task_upserted': {
        const task = event.task as Task;
        const existing = byId.get(task.id);
        byId.set(task.id, task);
        if (existing) {
          const index = tasks.findIndex((candidate) => candidate.id === task.id);
          tasks[index] = task;
        } else {
          tasks.push(task);
        }
        tasks.splice(0, tasks.length, ...sortTasks([...byId.values()], project.sections));
        view.upsert(task);
        if (panel && panel.taskId === task.id) void panel.refresh();
        break;
      }
      case 'task_deleted': {
        const taskId = event.taskId as string;
        byId.delete(taskId);
        const index = tasks.findIndex((candidate) => candidate.id === taskId);
        if (index !== -1) tasks.splice(index, 1);
        view.remove(taskId);
        announce('List status', 'Task deleted');
        if (panel && panel.taskId === taskId) panel.close();
        break;
      }
      case 'successor_created':
        announce('List status', String(event.announcement ?? ''));
        break;
      case 'section_added':
      case 'section_deleted':
      case 'field_upserted':
      case 'field_deleted':
        if (event.type === 'section_deleted') announce('List status', 'Section deleted');
        if (event.type === 'field_deleted') announce('List status', 'Field deleted');
        void reloadProject();
        break;
      case 'dependency_added':
        void reloadProject();
        break;
      case 'rule_run':
        if (panel && panel.taskId === event.taskId) panel.addRun(event.run as RuleRun);
        break;
      case 'rule_trace':
        view.trace(event.taskIds as string[]);
        break;
      case 'hold_changed':
        if (panel && panel.taskId === event.taskId) {
          panel.applyHold(
            event.field as string,
            event.holder as { id: string; name: string } | null,
          );
        }
        break;
      case 'presence_changed':
        if (panel && panel.taskId === event.taskId) {
          panel.applyViewing(event.viewing as { id: string; name: string }[]);
        }
        break;
      case 'approval_changed':
        if (typeof event.announcement === 'string') {
          announce('Approval status', event.announcement);
        }
        if (panel && panel.taskId === event.taskId) void panel.refresh();
        break;
      case 'attachment_added':
        if (panel && panel.taskId === event.taskId) void panel.refresh();
        break;
      default:
        break;
    }
  });
  main.addEventListener('page:teardown', stop, { once: true });

  const requestedTask = search.get('task');
  if (requestedTask && byId.has(requestedTask)) context.openTask(requestedTask, null);
}

function openDownload(projectId: string, opener: HTMLElement): void {
  openDialog({
    name: 'Download project',
    opener,
    build: (handle) => {
      const status = statusRegion('Download status');
      const linkHost = el('div', { class: 'dialog-link' });
      const formats = ['CSV', 'JSON'].map((label) => {
        const input = el('input', {
          type: 'radio',
          name: 'format',
          value: label.toLowerCase(),
          'aria-label': label,
        }) as HTMLInputElement;
        if (label === 'CSV') input.checked = true;
        return { label, input };
      });
      const prepare = el('button', { type: 'button', class: 'pill pill--dark' }, 'Prepare file');
      let stopLive: (() => void) | null = null;

      const finish = (file: { status: string; format: string; url?: string; error?: string }) => {
        if (file.status === 'ready' && file.url) {
          status.textContent = 'Ready';
          const link = el(
            'a',
            { href: file.url, class: 'pill pill--dark', download: '' },
            `Download ${file.format.toUpperCase()}`,
          );
          linkHost.replaceChildren(link);
          return;
        }
        if (file.status === 'failed') {
          status.textContent = 'Download failed: file storage is unavailable. Nothing was saved.';
          linkHost.replaceChildren();
          showStorageOutage();
          if (document.activeElement === document.body) prepare.focus();
        }
      };

      on(prepare, 'click', () => {
        if (prepare.getAttribute('aria-busy') === 'true') return;
        prepare.setAttribute('aria-busy', 'true');
        const chosen = formats.find((format) => format.input.checked);
        linkHost.replaceChildren();
        status.textContent = 'Preparing';
        void api
          .post<{ id: string; status: string }>(`/api/projects/${projectId}/files`, {
            format: chosen ? chosen.input.value : 'csv',
          })
          .then((job) => {
            stopLive?.();
            stopLive = onLive((event) => {
              if (event.type !== 'file_status') return;
              const file = event.file as { id: string; status: string; format: string; url?: string };
              if (file.id !== job.id) return;
              finish(file);
            });
            return api.get<{ status: string; format: string; url?: string; error?: string }>(
              `/api/files/${job.id}`,
            );
          })
          .then((file) => {
            if (file.status !== 'preparing') finish(file);
          })
          .catch(() => {
            status.textContent = 'Download failed: file storage is unavailable. Nothing was saved.';
          })
          .finally(() => prepare.removeAttribute('aria-busy'));
      });

      void clearStorageOutage;
      return el('div', { class: 'dialog-body stack' }, [
        el('h2', { class: 'dialog-title' }, 'Download project'),
        el(
          'div',
          { class: 'stack' },
          formats.map((format) =>
            el('label', { class: 'radio' }, [format.input, el('span', {}, format.label)]),
          ),
        ),
        prepare,
        status,
        linkHost,
      ]);
    },
  });
}
