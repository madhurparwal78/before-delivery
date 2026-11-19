// The ticket workspace: queues navigation, the list grid and the record form.

import { api, announce, navigate, hms, countdownText } from './core.js';
import type { RecordSummary, RecordView } from './core.js';
import { refreshSession, currentUser } from './shell.js';

interface Queue { id: number; name: string; table: string; filter: string }

/** The desk screen: three panes on desktop, two on tablet, one on phone. */
export async function desk(queueName?: string, newTable?: string, number?: string): Promise<HTMLElement> {
  const section = document.createElement('section');
  await refreshSession();
  const user = currentUser();

  const filters = await api<{ filters: Queue[] }>('/api/filters').catch(() => ({ filters: [] }));
  const queues = filters.filters.filter(q => q.table === 'incident');
  // Open incidents is the starting queue; it comes first.
  queues.sort((a, b) => (a.name === 'Open incidents' ? -1 : b.name === 'Open incidents' ? 1 : 0) || a.name.localeCompare(b.name));

  // The pinned subject: the queue's name, the record number, or New <Type>.
  const activeQueueName = queueName ?? new URLSearchParams(location.search).get('queue') ?? queues[0]?.name;
  const queue = queues.find(q => q.name === activeQueueName) ?? queues[0];
  if (number) {
    section.setAttribute('data-subject', number);
  } else if (newTable) {
    section.setAttribute('data-subject', `New ${labelForTable(newTable)}`);
  } else {
    section.setAttribute('data-subject', queue?.name ?? 'Desk');
  }

  const layout = document.createElement('div');
  layout.className = 'desk';
  const desktop = window.matchMedia('(min-width: 1024px)').matches;
  if (desktop) {
    layout.style.display = 'grid';
    layout.style.gridTemplateColumns = '1fr 2fr 2fr';
  } else if (window.matchMedia('(min-width: 768px)').matches) {
    layout.style.display = 'grid';
    layout.style.gridTemplateColumns = '1fr 1fr';
  } else {
    layout.style.display = 'block';
  }

  const nav = document.createElement('nav');
  nav.className = 'queues';
  nav.setAttribute('aria-label', 'Queues');
  if (desktop) layout.appendChild(nav);

  const listPane = document.createElement('div');
  listPane.className = 'white';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.gap = '8px';
  header.style.flexWrap = 'wrap';
  const roles = user?.roles ?? [];
  if (roles.includes('operator') || roles.includes('technician')) {
    for (const [label, table] of [['New incident', 'incident'], ['New problem', 'problem'], ['New task', 'task']] as Array<[string, string]>) {
      const button = document.createElement('button');
      button.textContent = label;
      button.addEventListener('click', () => navigate(`/desk/records/new/${table}`));
      header.appendChild(button);
    }
  }
  if (roles.includes('operator')) {
    const button = document.createElement('button');
    button.textContent = 'New change';
    button.addEventListener('click', () => navigate('/desk/records/new/change'));
    header.appendChild(button);
  }
  const filterButton = document.createElement('button');
  filterButton.textContent = 'Filter';
  filterButton.addEventListener('click', () => openFilterSheet(queue));
  header.appendChild(filterButton);
  listPane.appendChild(header);

  if (queue) {
    for (const q of queues) {
      const link = document.createElement('a');
      link.href = `/desk/lists/incident?queue=${encodeURIComponent(q.name)}`;
      link.textContent = q.name;
      if (q.name === queue.name) link.setAttribute('aria-current', 'page');
      nav.appendChild(link);
    }
    listPane.appendChild(await buildGrid(queue));
  }
  if (desktop) {
    layout.appendChild(listPane);
  } else {
    layout.append(listPane);
  }

  const formPane = document.createElement('div');
  formPane.className = 'white';
  if (newTable) {
    formPane.appendChild(await newRecordForm(newTable));
  } else if (number) {
    formPane.appendChild(await recordForm(number));
  } else {
    const empty = document.createElement('p');
    empty.textContent = 'Select a record to open it.';
    formPane.appendChild(empty);
  }
  layout.appendChild(formPane);

  section.appendChild(layout);
  return section;
}

/** The list as a grid (768px and above) or stacked cards (phone). */
async function buildGrid(queue: Queue): Promise<HTMLElement> {
  const params = new URLSearchParams({ filter: queue.filter });
  const data = await api<{ records: RecordSummary[]; total: number }>(`/api/tables/incident/records?${params}`);
  const records = data.records;

  if (!records.length) {
    const state = document.createElement('p');
    state.className = 'state-line';
    state.textContent = `Nothing waiting in ${queue.name}.`;
    const button = document.createElement('button');
    button.className = 'solid';
    button.textContent = 'Show all open incidents';
    button.addEventListener('click', () => navigate('/desk/lists/incident?queue=Open incidents'));
    state.appendChild(button);
    return state;
  }

  if (window.matchMedia('(min-width: 768px)').matches) {
    const table = document.createElement('table');
    table.className = 'grid-table';
    table.setAttribute('role', 'grid');
    table.setAttribute('aria-label', queue.name);
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.setAttribute('role', 'row');
    for (const label of ['Number', 'Short description', 'Priority', 'State', 'Assigned to', 'SLA']) {
      const th = document.createElement('th');
      th.setAttribute('role', 'columnheader');
      th.textContent = label;
      headRow.appendChild(th);
    }
    head.appendChild(headRow);
    table.appendChild(head);

    const body = document.createElement('tbody');
    for (const record of records) {
      const row = document.createElement('tr');
      row.setAttribute('role', 'row');
      row.tabIndex = 0;
      row.setAttribute('aria-label', rowLabel(record));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') navigate(`/desk/records/${record.number}`);
      });
      row.addEventListener('click', () => navigate(`/desk/records/${record.number}`));
      for (const cell of [record.number, record.short_description, String(record.priority ?? ''), record.state_label, record.assigned_to ?? 'nobody', slaText(record)]) {
        const td = document.createElement('td');
        td.setAttribute('role', 'gridcell');
        td.textContent = cell;
        row.appendChild(td);
      }
      body.appendChild(row);
    }
    table.appendChild(body);
    return table;
  }

  const list = document.createElement('ul');
  list.setAttribute('aria-label', queue.name);
  for (const record of records) {
    const item = document.createElement('li');
    item.className = 'card';
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.setAttribute('aria-label', rowLabel(record));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') navigate(`/desk/records/${record.number}`);
    });
    item.addEventListener('click', () => navigate(`/desk/records/${record.number}`));
    item.textContent = rowLabel(record);
    list.appendChild(item);
  }
  return list;
}

function rowLabel(record: RecordSummary): string {
  return record.sla ? `${record.label}, SLA ${record.sla.percent} percent` : `${record.label}, no SLA`;
}

function slaText(record: RecordSummary): string {
  if (!record.sla) return 'no SLA';
  const sla = record.sla;
  if (sla.stage === 'completed') return sla.breached ? 'Missed' : 'Met';
  if (sla.stage === 'paused') return `Paused at ${hms(sla.remaining_seconds)} left`;
  if (sla.breached) return `Breached by ${hms(-sla.remaining_seconds)}`;
  return `${hms(sla.remaining_seconds)} left`;
}

/** The filter dialog: a bottom sheet on the phone. */
function openFilterSheet(queue: Queue | undefined): void {
  if (!queue) return;
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', 'Filter');
  const form = document.createElement('form');

  const groups = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Groups match';
  groups.appendChild(legend);
  for (const [value, label] of [['and', 'All groups'], ['or', 'Any group']] as Array<[string, string]>) {
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'connector';
    radio.id = `connector-${value}`;
    radio.value = value;
    if (value === 'and') radio.checked = true;
    const labelEl = document.createElement('label');
    labelEl.htmlFor = radio.id;
    labelEl.textContent = label;
    groups.append(radio, labelEl);
  }
  form.appendChild(groups);

  const text = document.createElement('textarea');
  text.setAttribute('aria-label', 'Filter text');
  text.rows = 3;
  text.value = queue.filter;
  form.appendChild(text);

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'solid';
  apply.textContent = 'Apply filter';
  apply.addEventListener('click', async () => {
    try {
      const parsed = await api<{ filter: string }>('/api/filters/parse', {
        method: 'POST',
        body: JSON.stringify({ table: 'incident', filter: text.value }),
      });
      dialog.close();
      navigate(`/desk/lists/incident?queue=${encodeURIComponent(queue.name)}&filter=${encodeURIComponent(parsed.filter)}`);
    } catch (e) {
      announce(e instanceof Error ? e.message : 'The filter could not be applied.');
    }
  });
  form.appendChild(apply);

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.addEventListener('click', () => dialog.close());
  form.appendChild(close);

  dialog.appendChild(form);
  document.body.appendChild(dialog);
  dialog.showModal();
  text.focus();
}

function labelForTable(table: string): string {
  const labels: Record<string, string> = {
    incident: 'Incident', problem: 'Problem', change: 'Change', task: 'Task', request_item: 'Request item',
  };
  return labels[table] ?? table;
}

/** A new record form: fields start empty apart from published defaults. */
async function newRecordForm(table: string): Promise<HTMLElement> {
  const form = document.createElement('form');
  form.setAttribute('aria-label', `New ${labelForTable(table)}`);
  const heading = document.createElement('h2');
  heading.textContent = `New ${labelForTable(table)}`;
  form.appendChild(heading);

  const fields: Array<[string, string, string]> = table === 'change'
    ? [['title', 'Title', 'text'], ['model', 'Model', 'select'], ['configuration_item', 'Service or item', 'text']]
    : [['short_description', 'Short description', 'text'], ['configuration_item', 'Service or item', 'text']];
  const values: Record<string, string> = {};
  let first = true;
  for (const [name, label, kind] of fields) {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    let control: HTMLElement;
    if (kind === 'select') {
      const select = document.createElement('select');
      select.setAttribute('aria-label', label);
      for (const option of ['normal', 'standard', 'emergency']) {
        const el = document.createElement('option');
        el.value = option;
        el.textContent = option;
        select.appendChild(el);
      }
      select.addEventListener('change', () => { values[name] = select.value; });
      control = select;
    } else {
      const input = document.createElement('input');
      input.setAttribute('aria-label', label);
      input.addEventListener('input', () => { values[name] = input.value; });
      control = input;
      if (first && name === 'short_description' || (table === 'change' && name === 'title')) {
        window.setTimeout(() => input.focus(), 0);
        first = false;
      }
    }
    wrapper.appendChild(control);
    form.appendChild(wrapper);
  }

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'solid';
  save.textContent = 'Save';
  form.appendChild(save);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.textContent = 'Saving...';
    const body: Record<string, unknown> = {};
    for (const [name] of fields) body[name] = values[name] ?? null;
    try {
      const result = await api<{ record: { number: string } }>(`/api/tables/${table}/records`, {
        method: 'POST',
        body: JSON.stringify({ fields: body }),
      });
      announce(`Saved ${result.record.number}.`);
      navigate(`/desk/records/${result.record.number}`);
    } catch (err) {
      save.textContent = 'Save';
      announce(err instanceof Error ? err.message : 'The record could not be saved.');
    }
  });
  return form;
}

/** The record form: fields, SLA region, transitions, activity, notes. */
export async function recordForm(number: string): Promise<HTMLElement> {
  const form = document.createElement('form');
  form.setAttribute('aria-label', number);

  const data = await api<{ record: RecordView }>(`/api/records/${number}`);
  const record = data.record;

  const heading = document.createElement('h2');
  heading.textContent = number;
  heading.tabIndex = -1;
  form.appendChild(heading);

  const stateLine = document.createElement('p');
  stateLine.className = 'status solid-block';
  const block = document.createElement('span');
  block.className = 'block';
  stateLine.append(record.state_label, block);
  form.appendChild(stateLine);

  if (record.priority_overridden) {
    const badge = document.createElement('span');
    badge.textContent = 'Priority overridden';
    form.appendChild(badge);
  }

  for (const field of Object.values(record.fields)) {
    const wrapper = document.createElement('label');
    wrapper.textContent = field.label;
    const input = document.createElement('input');
    input.value = field.display;
    input.readOnly = field.read_only;
    wrapper.appendChild(input);
    form.appendChild(wrapper);
  }

  // The SLA region: one progressbar per non-cancelled SLA.
  const slaRegion = document.createElement('div');
  slaRegion.setAttribute('role', 'region');
  slaRegion.setAttribute('aria-label', 'SLA');
  for (const sla of record.slas) {
    if (sla.stage === 'cancelled') continue;
    const row = document.createElement('div');
    row.className = 'sla';
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', sla.definition);
    bar.setAttribute('aria-valuenow', String(sla.percent));
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = `${sla.percent}%`;
    bar.appendChild(fill);
    const countdown = document.createElement('span');
    countdown.className = 'countdown';
    countdown.textContent = countdownText(sla, sla.remaining_seconds);
    row.append(bar, countdown);
    slaRegion.appendChild(row);
  }
  form.appendChild(slaRegion);

  const buttons = document.createElement('div');
  buttons.style.display = 'flex';
  buttons.style.gap = '8px';
  buttons.style.flexWrap = 'wrap';
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'solid';
  save.textContent = 'Save';
  buttons.appendChild(save);
  for (const transition of record.transitions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Move to ${transition.label}`;
    button.addEventListener('click', async () => {
      button.textContent = 'Moving...';
      try {
        await api(`/api/records/${number}/transition`, {
          method: 'POST',
          body: JSON.stringify({ to: transition.to, fields: {} }),
        });
        announce(`${number} moved to ${transition.label}.`);
        navigate(`/desk/records/${number}`);
      } catch (err) {
        button.textContent = `Move to ${transition.label}`;
        announce(err instanceof Error ? err.message : 'The move failed.');
      }
    });
    buttons.appendChild(button);
  }
  form.appendChild(buttons);

  const noteLabel = document.createElement('label');
  noteLabel.textContent = 'Work note';
  const note = document.createElement('textarea');
  note.setAttribute('aria-label', 'Work note');
  noteLabel.appendChild(note);
  form.appendChild(noteLabel);
  const addNote = document.createElement('button');
  addNote.type = 'button';
  addNote.textContent = 'Add work note';
  addNote.addEventListener('click', async () => {
    await api(`/api/records/${number}/work-notes`, { method: 'POST', body: JSON.stringify({ text: note.value }) });
    announce('Note added.');
    note.value = '';
    navigate(`/desk/records/${number}`);
  });
  form.appendChild(addNote);

  const activity = await api<{ entries: Array<{ at: string; actor: string; kind: string; text: string }> }>(`/api/records/${number}/activity`);
  const activityRegion = document.createElement('div');
  activityRegion.setAttribute('role', 'region');
  activityRegion.setAttribute('aria-label', 'Activity');
  const list = document.createElement('ul');
  for (const entry of activity.entries) {
    const item = document.createElement('li');
    item.textContent = entry.text;
    list.appendChild(item);
  }
  activityRegion.appendChild(list);
  form.appendChild(activityRegion);

  return form;
}
