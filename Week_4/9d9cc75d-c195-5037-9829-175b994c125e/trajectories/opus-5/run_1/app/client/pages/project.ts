import { type ApiErrorBody, fieldErrors, get, send } from '../api.js';
import { el } from '../dom.js';
import type { Role } from '../../shared/types.js';

interface ProjectDoc {
  id: string;
  name: string;
  role: Role;
  explorers_schedule: boolean;
  members: { username: string; role: Role }[];
  sources: { id: string; name: string }[];
  workbooks: { id: string; name: string; state: string; certified_by: string | null }[];
}

export async function projectPage(host: HTMLElement, params: Record<string, string>): Promise<void> {
  document.body.dataset.field = 'ground';
  const res = await get<ProjectDoc>(`/api/projects/${params.id}`);
  if (res.status !== 200) {
    host.append(el('h1', { class: 'empty-headline', text: res.status === 403 ? 'You do not have access to this.' : 'Not found.' }));
    return;
  }
  const project = res.data;
  const status = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Announcements', class: 'status' });
  const membersBody = el('tbody');
  const memberError = el('p', { class: 'field-error' });

  const drawMembers = (members: { username: string; role: Role }[]): void => {
    membersBody.replaceChildren();
    for (const member of members) {
      const remove = el('button', { type: 'button', class: 'pill-button', text: `Remove ${member.username}` });
      remove.addEventListener('click', () => {
        void (async () => {
          await send('DELETE', `/api/projects/${project.id}/members/${member.username}`);
          const again = await get<ProjectDoc>(`/api/projects/${project.id}`);
          if (again.status === 200) drawMembers(again.data.members);
        })();
      });
      membersBody.append(
        el('tr', {}, [
          el('td', { text: member.username }),
          el('td', { text: member.role }),
          el('td', {}, [project.role === 'creator' ? remove : null]),
        ]),
      );
    }
  };
  drawMembers(project.members);

  const usernameInput = el('input', { type: 'text', id: 'member-username', class: 'input' });
  const roleSelect = el('select', { id: 'member-role', class: 'input' }, [
    el('option', { value: 'viewer', text: 'Viewer' }),
    el('option', { value: 'explorer', text: 'Explorer' }),
    el('option', { value: 'creator', text: 'Creator' }),
  ]);
  const addMember = el('button', { type: 'button', class: 'pill-button primary', text: 'Add member' });
  addMember.addEventListener('click', () => {
    void (async () => {
      memberError.textContent = '';
      const added = await send<{ username: string; role: Role } & ApiErrorBody>(
        'PUT',
        `/api/projects/${project.id}/members/${usernameInput.value.toLowerCase()}`,
        { role: roleSelect.value },
      );
      if (added.status === 200) {
        status.textContent = `Member added: ${added.data.username} as ${added.data.role}.`;
        const again = await get<ProjectDoc>(`/api/projects/${project.id}`);
        if (again.status === 200) drawMembers(again.data.members);
        usernameInput.value = '';
        return;
      }
      const errors = fieldErrors(added.data);
      memberError.textContent = errors.username ?? 'No such user.';
      status.textContent = memberError.textContent;
    })();
  });

  const scheduleBox = el('input', { type: 'checkbox', id: 'explorers-schedule' });
  if (project.explorers_schedule) scheduleBox.checked = true;
  scheduleBox.addEventListener('change', () => {
    void send('PATCH', `/api/projects/${project.id}`, { explorers_schedule: scheduleBox.checked });
  });

  const membersTable = el('table', { class: 'data-table', 'aria-label': 'Members' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Member' }),
        el('th', { scope: 'col', text: 'Role' }),
        el('th', { scope: 'col', text: 'Actions' }),
      ]),
    ]),
    membersBody,
  ]);

  const sources = el('ul', { class: 'plain-list' },
    project.sources.map((source) => el('li', {}, [el('a', { href: `/sources/${source.id}`, text: source.name })])),
  );
  const workbooks = el('ul', { class: 'plain-list' },
    project.workbooks.map((workbook) =>
      el('li', {}, [el('a', { href: `/workbooks/${workbook.id}`, text: workbook.name })]),
    ),
  );

  host.append(
    el('div', { class: 'page project-page' }, [
      el('h1', { text: project.name }),
      status,
      el('div', { class: 'two-column' }, [
        el('section', { class: 'card' }, [
          el('h2', { text: 'Members' }),
          membersTable,
          project.role === 'creator'
            ? el('div', { class: 'row' }, [
                el('label', { for: 'member-username', text: 'Member username' }),
                usernameInput,
                el('label', { for: 'member-role', text: 'Role' }),
                roleSelect,
                addMember,
              ])
            : null,
          memberError,
          el('div', { class: 'row' }, [
            scheduleBox,
            el('label', { for: 'explorers-schedule', text: 'Explorers may schedule refreshes' }),
          ]),
        ]),
        el('section', { class: 'card' }, [
          el('h2', { text: 'Sources' }),
          sources,
          el('p', {}, [el('a', { href: `/sources/new?project=${project.id}`, text: 'Upload a source' })]),
          el('h2', { text: 'Workbooks' }),
          workbooks,
        ]),
      ]),
    ]),
  );
}
