import { api, type Corridor } from '../api.js';
import { dueLine, stateWord } from '../format.js';

export async function renderCorridors(app: HTMLElement): Promise<void> {
  app.replaceChildren();
  const shell = document.createElement('div');
  shell.className = 'corridor-list';
  const h = document.createElement('h1');
  h.textContent = 'Corridors';
  shell.append(h);
  const container = document.createElement('div');
  shell.append(container);
  app.append(shell);

  let corridors: Corridor[] = [];
  try {
    const r = await api<{ corridors: Corridor[] }>('/api/corridors');
    corridors = r.corridors;
  } catch {
    container.textContent = 'Corridors could not be loaded.';
    return;
  }

  const buildTable = (): void => {
    container.replaceChildren();
    const isNarrow = window.innerWidth < 768;
    if (!isNarrow) {
      const table = document.createElement('table');
      table.setAttribute('aria-label', 'Corridors');
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const label of ['Corridor', 'Utility', 'Inspection due', 'Findings set']) {
        const th = document.createElement('th');
        th.scope = 'col';
        th.textContent = label;
        headRow.append(th);
      }
      thead.append(headRow);
      table.append(thead);
      const tbody = document.createElement('tbody');
      for (const c of corridors) tbody.append(corridorRow(c));
      table.append(tbody);
      container.append(table);
    } else {
      const list = document.createElement('ul');
      list.setAttribute('aria-label', 'Corridors');
      list.className = 'corridor-cards';
      for (const c of corridors) {
        const li = document.createElement('li');
        li.className = 'corridor-card';
        const name = document.createElement('a');
        name.href = `/corridors/${c.id}`;
        name.textContent = c.name;
        const utility = document.createElement('p');
        utility.textContent = c.utility.name;
        const due = document.createElement('p');
        due.className = 'mono';
        due.textContent = dueLine(c.inspection_due, c.utility.time_zone);
        const meta = document.createElement('p');
        const badge = c.overdue ? 'Overdue' : '';
        meta.append(
          ...(badge ? [overdueBadge(), ' · '] : []),
          setState(c),
        );
        li.append(name, utility, due, meta);
        list.append(li);
      }
      container.append(list);
    }
  };

  const corridorRow = (c: Corridor): HTMLTableRowElement => {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    const link = document.createElement('a');
    link.href = `/corridors/${c.id}`;
    link.textContent = c.name;
    tdName.append(link);
    const tdUtility = document.createElement('td');
    tdUtility.textContent = `${c.utility.name} · ${c.voltage_kv} kV`;
    const tdDue = document.createElement('td');
    const dueWrap = document.createElement('div');
    dueWrap.className = 'mono';
    dueWrap.textContent = dueLine(c.inspection_due, c.utility.time_zone);
    tdDue.append(dueWrap);
    if (c.overdue) tdDue.append(overdueBadge());
    const tdSet = document.createElement('td');
    tdSet.append(setState(c));
    tr.append(tdName, tdUtility, tdDue, tdSet);
    return tr;
  };

  const overdueBadge = (): HTMLElement => {
    const b = document.createElement('span');
    b.className = 'badge-overdue';
    b.textContent = 'Overdue';
    return b;
  };

  const setState = (c: Corridor): HTMLElement => {
    const s = document.createElement('span');
    if (c.current_set) {
      s.textContent = stateWord(c.current_set.state);
      s.className = 'set-state';
    } else {
      s.textContent = 'No findings set';
      s.className = 'set-state none';
    }
    return s;
  };

  buildTable();
  window.addEventListener('resize', buildTable);
}
