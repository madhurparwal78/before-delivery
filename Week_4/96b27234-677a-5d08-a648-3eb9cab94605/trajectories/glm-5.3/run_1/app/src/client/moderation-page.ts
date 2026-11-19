// Moderation page: the report queue, for Moderators only.
import { api, el, type Ctx } from './main';

interface Report {
  id: string;
  personId: string;
  personName: string;
  sessionId: string;
  roomName: string;
  category: string;
  details: string;
  state: string;
  action: string | null;
  createdAt: string;
}

export async function renderModerationPage(ctx: Ctx): Promise<void> {
  const main = ctx.main;
  main.append(el('h1', {}, 'Moderation'));

  const result = el('div', { role: 'status', 'aria-label': 'Moderation result', class: 'status-region' });
  const table = el('table', { 'aria-label': 'Reports' });
  const thead = el('thead', {}, el('tr', {}, ...['Reported', 'Room', 'Category', 'Details', 'State', 'Actions'].map((h) => el('th', {}, h))));
  table.append(thead);
  const tbody = el('tbody');
  table.append(tbody);

  const load = async (): Promise<void> => {
    const res = await api<{ reports: Report[] }>('/api/moderation/reports');
    tbody.textContent = '';
    for (const r of res.reports) {
      const row = el('tr', { 'data-report-id': r.id, 'data-report-state': r.state });
      row.append(el('td', {}, r.personName), el('td', {}, r.roomName), el('td', {}, r.category), el('td', {}, r.details), el('td', {}, r.state));
      const actions = el('td', {});
      if (r.state === 'open') {
        const start = el('button', {}, 'Start review');
        start.addEventListener('click', () => move(r.id, { state: 'reviewing' }, 'Start review'));
        actions.append(start);
      }
      if (r.state === 'reviewing') {
        const warn = el('button', {}, 'Warn');
        warn.addEventListener('click', () => move(r.id, { state: 'upheld', action: 'warn' }, 'Warn'));
        const suspend = el('button', { class: 'danger' }, 'Suspend');
        suspend.addEventListener('click', () => move(r.id, { state: 'upheld', action: 'suspend' }, 'Suspend'));
        const dismiss = el('button', {}, 'Dismiss');
        dismiss.addEventListener('click', () => move(r.id, { state: 'dismissed' }, 'Dismiss'));
        actions.append(warn, suspend, dismiss);
      }
      row.append(actions);
      tbody.append(row);
    }
  };

  const move = async (id: string, body: Record<string, string>, label: string): Promise<void> => {
    result.textContent = 'Saving...';
    try {
      const res = await api<{ state: string }>(`/api/moderation/reports/${id}/move`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      result.textContent = `Report moved to ${res.state}.`;
      await load();
    } catch (e) {
      result.textContent = (e as Error).message;
    }
    void label;
  };

  await load();
  main.append(el('div', { class: 'panel' }, table, result));
}
