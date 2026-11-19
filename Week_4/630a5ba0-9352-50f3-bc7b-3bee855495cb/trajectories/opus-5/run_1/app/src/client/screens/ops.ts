import { api } from '../api.js';
import { announce, registerScreen } from '../app.js';
import { el } from '../dom.js';
import { dayLabel, localDateOf } from '../../shared/time.js';

const STATE_COPY: Record<string, string> = {
  trialing: 'Trialing',
  active: 'Active',
  past_due: 'Past due',
  read_only: 'Read-only',
  cancelled: 'Cancelled',
};

registerScreen('/ops', async (root) => {
  root.append(el('h2', { text: 'Operations' }));
  const result = await api.ops().catch(() => {
    announce('Something went wrong on our side. Nothing was changed.');
    return { workspaces: [] };
  });

  const body = el('tbody');
  for (const workspace of result.workspaces) {
    const billed = workspace.billedSeats === null ? '\u2014' : String(workspace.billedSeats);
    body.append(
      el('tr', {}, [
        el('td', { 'data-label': 'Workspace', text: workspace.name }),
        el('td', { 'data-label': 'State', text: STATE_COPY[workspace.state] ?? workspace.state }),
        el('td', {
          'data-label': 'Trial ends',
          class: 'num',
          text: dayLabel(localDateOf(new Date(workspace.trialEndsAt), 'UTC')),
        }),
        el('td', { 'data-label': 'Seats', class: 'num', text: `${workspace.activeSeats} / ${billed}` }),
        el('td', { 'data-label': 'Queued', class: 'num', text: String(workspace.outbox.pending) }),
        el('td', {
          'data-label': 'Last import',
          class: 'num',
          text: workspace.imports.lastAt
            ? dayLabel(localDateOf(new Date(workspace.imports.lastAt), 'UTC'))
            : '\u2014',
        }),
      ]),
    );
  }

  root.append(
    el('table', { class: 'data-table', 'aria-label': 'Workspaces' }, [
      el('caption', { text: 'Workspaces' }),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Workspace' }),
          el('th', { scope: 'col', text: 'State' }),
          el('th', { scope: 'col', text: 'Trial ends' }),
          el('th', { scope: 'col', text: 'Seats' }),
          el('th', { scope: 'col', text: 'Queued' }),
          el('th', { scope: 'col', text: 'Last import' }),
        ]),
      ]),
      body,
    ]),
  );
});
