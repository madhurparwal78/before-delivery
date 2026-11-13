import { announce, api, qs, qsa } from './core';
import { initTheme } from './theme';

initTheme();

interface TeamData {
  id: string; name: string;
  members: { userId: string; name: string; email: string; role: string }[];
  invites: { id: string; email: string; role: string; status: string; createdAt: string; sentAt: string | null }[];
}

function loadTeam(): void {
  void api<TeamData>('GET', '/api/team').then((res) => {
    if (!res.data) return;
    render(res.data);
  });
}

function render(team: TeamData): void {
  const membersBody = qs<HTMLElement>('[data-members-body]');
  if (membersBody) {
    membersBody.textContent = '';
    for (const m of team.members) {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = m.name;
      const email = document.createElement('td');
      email.textContent = m.email;
      const role = document.createElement('td');
      if (m.role === 'owner') {
        role.textContent = 'Owner';
      } else {
        const select = document.createElement('select');
        select.setAttribute('aria-label', `Role for ${m.name}`);
        for (const value of ['editor', 'viewer'] as const) {
          const opt = document.createElement('option');
          opt.value = value;
          opt.textContent = value === 'editor' ? 'Editor' : 'Viewer';
          opt.selected = m.role === value;
          select.append(opt);
        }
        select.addEventListener('change', () => {
          void api('PUT', `/api/team/members/${m.userId}`, { role: select.value });
        });
        role.append(select);
      }
      tr.append(name, email, role);
      membersBody.append(tr);
    }
  }
  const invitesBody = qs<HTMLElement>('[data-invites-body]');
  if (invitesBody) {
    invitesBody.textContent = '';
    const labels: Record<string, string> = {
      held: 'Held: mail is unavailable', sent: 'Sent', accepted: 'Accepted', expired: 'Expired',
    };
    for (const i of team.invites) {
      const tr = document.createElement('tr');
      const email = document.createElement('td');
      email.textContent = i.email;
      const role = document.createElement('td');
      role.textContent = i.role === 'editor' ? 'Editor' : 'Viewer';
      const status = document.createElement('td');
      status.textContent = labels[i.status] ?? i.status;
      if (i.status === 'held') {
        const send = document.createElement('button');
        send.type = 'button';
        send.textContent = 'Send now';
        send.addEventListener('click', () => {
          void api('POST', `/api/team/invites/${i.id}/send`).then((res) => {
            if (res.error) announce(res.error.message);
            else loadTeam();
          });
        });
        status.append(' ', send);
      }
      tr.append(email, role, status);
      invitesBody.append(tr);
    }
  }
}

const inviteForm = qs<HTMLFormElement>('[data-invite-form]');
if (inviteForm) {
  inviteForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = inviteForm.querySelector<HTMLInputElement>('[data-invite-email]')?.value ?? '';
    const role = inviteForm.querySelector<HTMLSelectElement>('[data-invite-role]')?.value ?? 'viewer';
    void api('POST', '/api/team/invites', { email, role }).then((res) => {
      if (res.status === 201) {
        announce(`Invite sent to ${email.toLowerCase()}.`);
        loadTeam();
      } else if (res.status === 202) {
        announce("Invite held: mail is unavailable. We'll send it when mail is back.");
        loadTeam();
      } else if (res.error) {
        announce(res.error.message);
      }
    });
  });
}

loadTeam();

const es = new EventSource('/api/events');
es.addEventListener('invite', () => loadTeam());
es.addEventListener('role', () => loadTeam());
