import { api, ApiCallError } from '../api.js';
import { clear, el, on } from '../dom.js';
import { openDialog } from '../dialog.js';
import { labelledField } from '../forms.js';
import { onLive } from '../live.js';
import { currentTeam } from '../state.js';
import { internalLink } from '../topbar.js';
import { navigate } from '../router.js';

interface MyWorkGroup {
  key: string;
  label: string;
  tasks: { id: string; name: string; projectId: string; projectName: string; due: string | null; dueStatus: string }[];
}

export async function renderMyWork(main: HTMLElement): Promise<void> {
  main.className = 'page page--work';
  const team = currentTeam();
  const heading = el('h1', { class: 'page__title' }, 'My work');
  const tasksPanel = el('section', { class: 'panel' });
  const projectsPanel = el('section', { class: 'panel' });
  main.append(heading, el('div', { class: 'work-grid' }, [tasksPanel, projectsPanel]));

  const newProject = el('button', { type: 'button', class: 'pill pill--dark' }, 'New project');
  const projectList = el('ul', { class: 'link-stack', 'aria-label': 'Projects' });

  const drawProjects = async () => {
    if (!team) return;
    const data = await api.get<{ projects: { id: string; name: string; progress: number }[] }>(
      `/api/teams/${team.id}/projects`,
    );
    clear(projectList);
    for (const project of data.projects) {
      projectList.appendChild(
        el('li', { class: 'link-card' }, [
          internalLink(project.name, `/projects/${project.id}`, 'link-card__link'),
          el('span', { class: 'link-card__meta tabular' }, `${Math.floor(project.progress + 0.5)}%`),
        ]),
      );
    }
  };

  const drawTasks = async () => {
    const data = await api.get<{ serverDate: string; groups: MyWorkGroup[] }>('/api/my-work');
    clear(tasksPanel);
    tasksPanel.appendChild(el('h2', { class: 'panel__title' }, 'Assigned to you'));
    if (data.groups.length === 0) {
      const seeProjects = el('button', { type: 'button', class: 'pill pill--dark' }, 'See projects');
      on(seeProjects, 'click', () => projectList.focus());
      tasksPanel.appendChild(
        el('div', { class: 'empty' }, [
          el('p', { class: 'empty__sentence' }, 'Nothing is assigned to you yet.'),
          seeProjects,
        ]),
      );
      return;
    }
    for (const group of data.groups) {
      tasksPanel.appendChild(el('h3', { class: 'group__heading' }, group.label));
      tasksPanel.appendChild(
        el(
          'ul',
          { class: 'task-list' },
          group.tasks.map((task) =>
            el('li', { class: 'task-list__row', 'data-task': task.id }, [
              internalLink(task.name, `/projects/${task.projectId}`, 'task-list__link'),
              el('span', { class: 'chip chip--status' }, group.label),
              el('span', { class: 'task-list__meta' }, task.projectName),
            ]),
          ),
        ),
      );
    }
  };

  on(newProject, 'click', () => {
    if (!team) return;
    openDialog({
      name: 'New project',
      opener: newProject,
      build: (handle) => {
        const projectName = labelledField({ name: 'Project name' });
        const sections = labelledField({
          name: 'Sections',
          hint: 'Comma separated, for example: To do, Doing, Done',
        });
        const create = el('button', { type: 'submit', class: 'pill pill--dark' }, 'Create project');
        const cancel = el('button', { type: 'button', class: 'pill pill--ghost' }, 'Cancel');
        on(cancel, 'click', handle.close);
        const form = el('form', { class: 'dialog-body stack' }, [
          el('h2', { class: 'dialog-title' }, 'New project'),
          projectName.wrap,
          sections.wrap,
          el('div', { class: 'dialog-actions' }, [create, cancel]),
        ]) as HTMLFormElement;
        on(form, 'submit', (event) => {
          event.preventDefault();
          if (create.getAttribute('aria-busy') === 'true') return;
          create.setAttribute('aria-busy', 'true');
          void api
            .post<{ id: string }>(`/api/teams/${team.id}/projects`, {
              name: (projectName.input as HTMLInputElement).value,
              sections: (sections.input as HTMLInputElement).value
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s !== ''),
            })
            .then((project) => {
              handle.dismiss();
              navigate(`/projects/${project.id}`);
            })
            .catch((err) => {
              if (err instanceof ApiCallError) {
                projectName.setError(err.failure.errors?.name ?? null);
                sections.setError(err.failure.errors?.sections ?? null);
              }
              create.removeAttribute('aria-busy');
            });
        });
        return form;
      },
    });
  });

  clear(projectsPanel);
  projectsPanel.append(
    el('h2', { class: 'panel__title' }, 'Projects'),
    projectList,
    newProject,
  );

  await drawTasks();
  await drawProjects();

  const stop = onLive((event) => {
    if (['task_upserted', 'task_deleted', 'project_added'].includes(event.type)) {
      void drawTasks();
      void drawProjects();
    }
  });
  main.addEventListener('page:teardown', stop, { once: true });
}
