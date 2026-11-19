import { ApiFailure, request } from '../api.js';
import { clear, el, field, showFieldError } from '../dom.js';
import { openDialog } from '../ui/dialog.js';
import { StatusRegion } from '../ui/status.js';
import type { Screen } from '../router.js';
import { genericFailure, membersCopy } from '../../shared/copy.js';
import type { InvitationView, MemberView, ProjectView, Role } from '../../shared/types.js';

const roleOptions: readonly { value: Role; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'developer', label: 'Developer' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'approver', label: 'Approver' },
  { value: 'billing', label: 'Billing viewer' },
];

const roleSelect = (id: string, name: string, selected: Role | null): HTMLSelectElement => {
  const select = el(
    'select',
    { id, 'aria-label': name, class: 'input' },
    roleOptions.map((option) => el('option', { value: option.value, text: option.label })),
  );
  if (selected !== null) select.value = selected;
  return select;
};

export const membersScreen = (): Screen => {
  const status = new StatusRegion('Members status');
  const body = el('tbody');
  const table = el('table', { 'aria-label': 'Members', class: 'table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Name' }),
        el('th', { scope: 'col', text: 'Email' }),
        el('th', { scope: 'col', text: 'Role' }),
        el('th', { scope: 'col', text: 'Projects' }),
        el('th', { scope: 'col', text: 'Action' }),
      ]),
    ]),
    body,
  ]);
  const invitationsBody = el('tbody');
  const invitations = el('table', { 'aria-label': 'Open invitations', class: 'table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Name' }),
        el('th', { scope: 'col', text: 'Email' }),
        el('th', { scope: 'col', text: 'Role' }),
      ]),
    ]),
    invitationsBody,
  ]);

  const invite = el('button', { type: 'button', class: 'button button-primary', text: 'Invite teammate' });
  const node = el('section', { class: 'screen' }, [
    el('div', { class: 'screen-header' }, [el('h1', { class: 'screen-title', text: 'Members' }), invite]),
    status.node,
    table,
    el('h2', { class: 'section-title', text: 'Open invitations' }),
    invitations,
  ]);

  let projects: ProjectView[] = [];

  const load = async (): Promise<void> => {
    const [reply, projectReply] = await Promise.all([
      request<{ members: MemberView[]; invitations: InvitationView[] }>('/api/org/members'),
      request<{ projects: ProjectView[] }>('/api/projects'),
    ]);
    projects = projectReply.projects;
    const names = new Map(projects.map((project) => [project.id, project.name]));
    clear(body);
    for (const member of reply.members) {
      const select = roleSelect(`role-${member.id}`, `Role for ${member.name}`, member.role);
      select.addEventListener('change', () => {
        void request(`/api/org/members/${member.id}`, { method: 'PATCH', json: { role: select.value } })
          .then(() => {
            status.set(membersCopy.updated);
            void load();
          })
          .catch((error: unknown) => {
            status.set(
              error instanceof ApiFailure && error.code === 'self_change' ? membersCopy.selfChange : genericFailure,
            );
            void load();
          });
      });
      const remove = el('button', { type: 'button', class: 'button', text: `Remove ${member.name}` });
      remove.setAttribute('aria-label', `Remove ${member.name}`);
      remove.addEventListener('click', () => {
        void request(`/api/org/members/${member.id}`, { method: 'DELETE' })
          .then(() => {
            status.set(membersCopy.removed);
            void load();
          })
          .catch((error: unknown) =>
            status.set(
              error instanceof ApiFailure && error.code === 'self_change' ? membersCopy.selfChange : genericFailure,
            ),
          );
      });
      body.append(
        el('tr', {}, [
          el('th', { scope: 'row', text: member.name }),
          el('td', { text: member.email }),
          el('td', {}, [select]),
          el('td', {
            text: member.project_ids.map((id) => names.get(id) ?? id).join(', ') || 'All projects',
          }),
          el('td', {}, [remove]),
        ]),
      );
    }
    clear(invitationsBody);
    for (const invitation of reply.invitations)
      invitationsBody.append(
        el('tr', {}, [
          el('th', { scope: 'row', text: invitation.name }),
          el('td', { text: invitation.email }),
          el('td', { text: invitation.role }),
        ]),
      );
  };

  invite.addEventListener('click', () => {
    openDialog('Invite teammate', (handle) => {
      const name = el('input', { type: 'text', id: 'invite-name', 'aria-label': 'Name', class: 'input' });
      const email = el('input', { type: 'email', id: 'invite-email', 'aria-label': 'Email', class: 'input' });
      const role = roleSelect('invite-role', 'Role', 'reviewer');
      const nameField = field('Name', name, 'invite-name-error');
      const emailField = field('Email', email, 'invite-email-error');
      const roleField = field('Role', role, 'invite-role-error');
      const checkboxes = projects.map((project) => {
        const box = el('input', { type: 'checkbox', id: `invite-project-${project.id}`, value: project.id });
        box.setAttribute('aria-label', project.name);
        return { box, row: el('label', { class: 'checkbox', for: box.id }, [box, el('span', { text: project.name })]) };
      });
      const create = el('button', { type: 'submit', class: 'button button-primary', text: 'Create invitation' });
      const form = el('form', { class: 'dialog-form', novalidate: true }, [
        el('h2', { class: 'dialog-title', text: 'Invite teammate' }),
        nameField.row,
        emailField.row,
        roleField.row,
        el('fieldset', { class: 'checkbox-group' }, [
          el('legend', { class: 'field-label', text: 'Projects' }),
          ...checkboxes.map((entry) => entry.row),
        ]),
        el('div', { class: 'dialog-actions' }, [create]),
      ]);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        create.disabled = true;
        showFieldError(name, nameField.error, null);
        showFieldError(email, emailField.error, null);
        void request<{ id: string; invite_url: string }>('/api/org/invitations', {
          method: 'POST',
          json: {
            name: name.value,
            email: email.value,
            role: role.value,
            project_ids: checkboxes.filter((entry) => entry.box.checked).map((entry) => entry.box.value),
          },
        })
          .then((reply) => {
            status.set(membersCopy.invitationCreated(name.value.trim()));
            const link = el('input', {
              type: 'text',
              id: 'invitation-link',
              'aria-label': 'Invitation link',
              class: 'input',
              readonly: true,
            });
            link.value = `${window.location.origin}${reply.invite_url}`;
            clear(form);
            form.append(
              el('h2', { class: 'dialog-title', text: 'Invite teammate' }),
              field('Invitation link', link, 'invitation-link-error').row,
            );
            link.focus();
            void load();
          })
          .catch((error: unknown) => {
            create.disabled = false;
            if (error instanceof ApiFailure && error.code === 'email_taken') {
              showFieldError(email, emailField.error, 'That email already has a member or invitation.');
              return;
            }
            const fields = error instanceof ApiFailure ? error.fields : {};
            showFieldError(name, nameField.error, fields.name ?? null);
            showFieldError(email, emailField.error, fields.email ?? null);
            showFieldError(role, roleField.error, fields.role ?? null);
            if (Object.keys(fields).length === 0) status.set(genericFailure);
          });
      });
      handle.body.append(form);
    });
  });

  void load();
  return { node };
};
