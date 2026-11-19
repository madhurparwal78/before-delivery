import { h, clear, api, announce, openDialog } from './dom';
import { me } from './live';
import { renderTopbar } from './topbar';
import { WorkloadData } from './types';

export async function renderWorkload(root: HTMLElement): Promise<void> {
  const who = await me();
  if (!who) { window.location.href = '/account'; return; }
  const teamId = window.location.pathname.split('/').filter(Boolean)[1] ?? who.teams[0]?.id;
  if (!teamId) return;
  const from = new URLSearchParams(window.location.search).get('from');
  const res = await api<WorkloadData>('GET', `/api/teams/${teamId}/workload${from ? `?from=${from}` : ''}`);
  const data = res.data;

  clear(root);
  renderTopbar(root, { personName: who.name, unread: 0, active: null });
  const main = h('main', { class: 'viewbody', style: 'max-width:1100px;margin:0 auto' });
  main.append(h('h1', {}, 'Workload'));

  const grid = h('div', { class: 'wl' });
  const table = h('table', { role: 'grid', 'aria-label': 'Workload' });
  const headRow = h('tr', { role: 'row' }, h('th', { role: 'columnheader' }, 'Person'));
  for (const d of data.days) headRow.append(h('th', { role: 'columnheader', class: 'num' }, d));
  table.append(h('thead', {}, headRow));
  const tbody = h('tbody');
  table.append(tbody);
  grid.append(table);
  main.append(grid);
  root.append(main);

  const focusCell = (row: number, col: number): void => {
    const rows = Array.from(tbody.querySelectorAll<HTMLElement>('td[data-date]'));
    const target = rows.find(c => c.dataset.personIdx === String(row) && c.dataset.dateIdx === String(col));
    target?.focus();
  };

  data.people.forEach((p, pi) => {
    const tr = h('tr', { role: 'row' });
    tr.append(h('td', {}, p.name));
    p.cells.forEach((c, ci) => {
      const td = h('td', {
        role: 'gridcell', tabindex: '0',
        'data-person': p.id, 'data-date': c.date, 'data-total': c.total.toFixed(2),
        'data-over': c.over ? 'true' : 'false',
        'data-person-idx': String(pi), 'data-date-idx': String(ci),
        class: c.over ? 'over' : '',
      }, c.text);
      td.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight') { e.preventDefault(); focusCell(pi, Math.min(p.cells.length - 1, ci + 1)); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); focusCell(pi, Math.max(0, ci - 1)); }
        if (e.key === 'ArrowDown') { e.preventDefault(); focusCell(Math.min(data.people.length - 1, pi + 1), ci); }
        if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(Math.max(0, pi - 1), ci); }
        if (e.key === 'Enter') { e.preventDefault(); openCellDialog(p, c.date, pi, ci); }
      });
      tr.append(td);
    });
    tbody.append(tr);
    void p.cells;
  });

  function openCellDialog(person: { id: string; name: string }, date: string, pi: number, ci: number): void {
    const cell = data.people[pi].cells[ci];
    openDialog((container, close) => {
      const chips = h('div', { class: 'row' });
      for (const t of cell.tasks) {
        const chip = h('button', {
          class: 'pill outline', tabindex: '0', 'aria-label': t.name,
          onkeydown: async (e: KeyboardEvent) => {
            if (e.key === 'r' || e.key === 'R') { e.preventDefault(); openReassign(t.id); }
          },
          onclick: () => openReassign(t.id),
        }, t.name);
        chips.append(chip);
      }
      container.append(h('h2', {}, `Tasks for ${person.name} on ${date}`), chips,
        h('div', { class: 'actions' }, h('button', { class: 'pill quiet', onclick: close }, 'Close')));
    });
  }

  function openReassign(taskId: string): void {
    openDialog((container, close) => {
      const sel = h('select', { 'aria-label': 'Assignee' }) as HTMLSelectElement;
      for (const p of data.people) sel.append(h('option', { value: p.id }, p.name));
      const btn = h('button', {
        class: 'pill primary', onclick: async () => {
          const r = await api('PATCH', `/api/tasks/${taskId}`, { assigneeId: sel.value });
          if (r.ok) { announce('Workload status', `Reassigned to ${sel.selectedOptions[0].textContent}`); close(); window.location.reload(); }
        },
      }, 'Reassign');
      container.append(h('h2', {}, 'Reassign task'),
        h('div', { class: 'field' }, h('label', {}, 'Assignee'), sel),
        h('div', { class: 'actions' }, h('button', { class: 'pill quiet', onclick: close }, 'Cancel'), btn));
    });
  }
}
