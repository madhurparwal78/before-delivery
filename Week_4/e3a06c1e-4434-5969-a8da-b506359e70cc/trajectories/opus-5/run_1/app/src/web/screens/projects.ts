import { ApiFailure, request } from '../api.js';
import { clear, el, field, showFieldError } from '../dom.js';
import { setFlash } from '../flash.js';
import { navigate, type Screen } from '../router.js';
import { may, type Identity } from '../state.js';
import { openDialog } from '../ui/dialog.js';
import { StatusRegion } from '../ui/status.js';
import { quotaMeterText } from '../../shared/billing.js';
import { fieldCopy, genericFailure, keysCopy } from '../../shared/copy.js';
import type { ProjectView } from '../../shared/types.js';

const newProjectDialog = (onCreated: (project: ProjectView) => void): void => {
  openDialog('New project', (handle) => {
    const name = el('input', { type: 'text', id: 'new-project-name', 'aria-label': 'Project name', class: 'input' });
    const quota = el('input', {
      type: 'text',
      inputmode: 'numeric',
      id: 'new-project-quota',
      'aria-label': 'Monthly quota (minutes)',
      class: 'input numeric',
    });
    const nameField = field('Project name', name, 'new-project-name-error');
    const quotaField = field('Monthly quota (minutes)', quota, 'new-project-quota-error');
    const create = el('button', { type: 'submit', class: 'button button-primary', text: 'Create project' });
    const cancel = el('button', { type: 'button', class: 'button', text: 'Cancel' });
    const status = new StatusRegion('New project status');
    cancel.addEventListener('click', () => handle.close());

    const form = el('form', { class: 'dialog-form', novalidate: true }, [
      el('h2', { class: 'dialog-title', text: 'New project' }),
      nameField.row,
      quotaField.row,
      el('div', { class: 'dialog-actions' }, [create, cancel]),
      status.node,
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      create.disabled = true;
      showFieldError(name, nameField.error, null);
      showFieldError(quota, quotaField.error, null);
      void request<{ project: ProjectView }>('/api/projects', {
        method: 'POST',
        json: { name: name.value, monthly_quota_minutes: Number(quota.value.trim()) },
      })
        .then((reply) => {
          handle.close();
          onCreated(reply.project);
        })
        .catch((error: unknown) => {
          create.disabled = false;
          if (error instanceof ApiFailure && error.code === 'name_taken') {
            showFieldError(name, nameField.error, fieldCopy.projectNameTaken);
            return;
          }
          const fields = error instanceof ApiFailure ? error.fields : {};
          showFieldError(name, nameField.error, fields.name ?? null);
          showFieldError(quota, quotaField.error, fields.monthly_quota_minutes ?? null);
          if (Object.keys(fields).length === 0) status.set(genericFailure);
        });
    });
    handle.body.append(form);
  });
};

export const projectsScreen = (identity: Identity): Screen => {
  const body = el('tbody');
  const table = el('table', { 'aria-label': 'Projects', class: 'table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Project' }),
        el('th', { scope: 'col', text: 'Quota used' }),
        el('th', { scope: 'col', text: 'Sessions' }),
      ]),
    ]),
    body,
  ]);

  const header = el('div', { class: 'screen-header' }, [el('h1', { class: 'screen-title', text: 'Projects' })]);
  if (may(identity.user.role, 'members')) {
    const create = el('button', { type: 'button', class: 'button button-primary', text: 'New project' });
    create.addEventListener('click', () =>
      newProjectDialog((project) => {
        setFlash(keysCopy.projectCreated);
        navigate(`/console/projects/${project.id}/keys`);
      }),
    );
    header.append(create);
  }

  const node = el('section', { class: 'screen' }, [header, table]);

  const load = async (): Promise<void> => {
    const reply = await request<{ projects: ProjectView[] }>('/api/projects');
    clear(body);
    for (const project of reply.projects)
      body.append(
        el('tr', {}, [
          el('th', { scope: 'row' }, [
            el('a', { href: `/console/projects/${project.id}/keys`, class: 'link', text: project.name }),
          ]),
          el('td', { class: 'numeric', text: quotaMeterText(project.quota.used_seconds, project.quota.limit_minutes) }),
          el('td', { class: 'numeric', text: String(project.sessions) }),
        ]),
      );
  };
  void load();

  return { node };
};
