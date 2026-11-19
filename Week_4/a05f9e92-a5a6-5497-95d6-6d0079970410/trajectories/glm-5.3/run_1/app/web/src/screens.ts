// Screens: map, major incident, approvals, on-call, calendar, board, admin,
// designer, dashboards, config sets, imports, exports and inbox.

import { api, announce, navigate } from './core.js';

/* ---------- Inbox ---------- */
export async function inboxScreen(): Promise<HTMLElement> {
  const section = document.createElement('section');
  section.className = 'white';
  const wrapper = document.createElement('div');
  wrapper.style.maxWidth = '64ch';
  wrapper.style.margin = '0 auto';

  const data = await api<{ items: Array<{ id: number; event: string; text: string; record: string | null; at: string; read: boolean }>; unread: number }>('/api/inbox');
  const heading = document.createElement('h2');
  heading.textContent = 'Inbox';
  wrapper.appendChild(heading);

  if (!data.items.length) {
    const line = document.createElement('p');
    line.className = 'state-line';
    line.textContent = 'Your inbox is empty.';
    const back = document.createElement('button');
    back.className = 'solid';
    back.textContent = 'Back to your desk';
    back.addEventListener('click', () => navigate('/desk'));
    line.appendChild(back);
    wrapper.appendChild(line);
    section.appendChild(wrapper);
    return section;
  }

  const list = document.createElement('ul');
  list.setAttribute('aria-label', 'Inbox');
  for (const item of data.items) {
    const li = document.createElement('li');
    li.textContent = item.read ? item.text : `Unread: ${item.text}`;
    list.appendChild(li);
  }
  wrapper.appendChild(list);

  const markAll = document.createElement('button');
  markAll.textContent = 'Mark all read';
  markAll.addEventListener('click', async () => {
    await api('/api/inbox/read-all', { method: 'POST', body: JSON.stringify({}) });
    announce('All items read.');
    navigate('/inbox');
  });
  wrapper.appendChild(markAll);

  const digestLabel = document.createElement('label');
  digestLabel.textContent = 'Digest';
  const digest = document.createElement('select');
  digest.setAttribute('aria-label', 'Digest');
  for (const [value, label] of [['immediate', 'Immediately'], ['daily', 'Daily digest']] as Array<[string, string]>) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    digest.appendChild(option);
  }
  digest.addEventListener('change', async () => {
    await api('/api/inbox/settings', { method: 'PUT', body: JSON.stringify({ digest: digest.value }) });
    announce('Digest setting saved.');
  });
  digestLabel.appendChild(digest);
  wrapper.appendChild(digestLabel);

  section.appendChild(wrapper);
  return section;
}

/* ---------- Approvals ---------- */
export async function approve(): Promise<HTMLElement> {
  const section = document.createElement('section');
  section.className = 'white';
  const wrapper = document.createElement('div');
  wrapper.style.maxWidth = '64ch';
  wrapper.style.margin = '0 auto';

  const data = await api<{ approvals: Array<{ kind: string; id: string; record: string; title: string; closes_at: string | null; step: string | null }> }>('/api/approvals');
  const heading = document.createElement('h2');
  heading.textContent = 'Your votes';
  wrapper.appendChild(heading);

  if (!data.approvals.length) {
    const line = document.createElement('p');
    line.className = 'state-line';
    line.textContent = 'No votes waiting for you.';
    const open = document.createElement('button');
    open.className = 'solid';
    open.textContent = 'Open changes';
    open.addEventListener('click', () => navigate('/desk/changes/calendar'));
    line.appendChild(open);
    wrapper.appendChild(line);
    section.appendChild(wrapper);
    return section;
  }

  for (const approval of data.approvals) {
    const article = document.createElement('article');
    article.setAttribute('aria-label', `${approval.record}: ${approval.title}`);
    article.textContent = `${approval.record}: ${approval.title}`;
    const approveButton = document.createElement('button');
    approveButton.textContent = 'Approve';
    approveButton.addEventListener('click', async () => {
      await api(`/api/approvals/${encodeURIComponent(approval.id)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approve', comment: '' }) });
      announce(`Vote recorded: approve on ${approval.record}.`);
      navigate('/approve');
    });
    const rejectButton = document.createElement('button');
    rejectButton.textContent = 'Reject';
    rejectButton.addEventListener('click', async () => {
      await api(`/api/approvals/${encodeURIComponent(approval.id)}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'reject', comment: '' }) });
      announce(`Vote recorded: reject on ${approval.record}.`);
      navigate('/approve');
    });
    article.append(approveButton, rejectButton);
    wrapper.appendChild(article);
  }

  section.appendChild(wrapper);
  return section;
}

/* ---------- Service map ---------- */
interface MapNode { name: string; class: string; status: string; layer: number; x: number; y: number }

export async function serviceMap(): Promise<HTMLElement> {
  const section = document.createElement('section');

  const wrapper = document.createElement('div');
  if (window.matchMedia('(min-width: 768px)').matches) {
    wrapper.style.display = 'grid';
    wrapper.style.gridTemplateColumns = '3fr 2fr';
  }

  const canvas = document.createElement('div');
  canvas.setAttribute('role', 'group');
  canvas.setAttribute('aria-label', 'Service map');
  canvas.style.position = 'relative';
  canvas.style.minHeight = '600px';
  canvas.style.overflow = 'auto';
  canvas.tabIndex = 0;

  const data = await api<{ nodes: MapNode[]; edges: Array<{ source: string; type: string; target: string }> }>('/api/service-map');
  const selected = new URLSearchParams(location.search).get('node');
  for (const node of data.nodes) {
    const button = document.createElement('button');
    button.textContent = `${node.name}, ${classLabel(node.class)}, ${statusLabel(node.status)}`;
    button.setAttribute('aria-label', `${node.name}, ${classLabel(node.class)}, ${statusLabel(node.status)}`);
    button.style.position = 'absolute';
    button.style.left = `${node.x / 4}px`;
    button.style.top = `${node.y / 4}px`;
    button.style.width = '160px';
    button.style.height = '64px';
    button.dataset.x = String(node.x);
    button.dataset.y = String(node.y);
    button.addEventListener('click', () => navigate(`/desk/map?node=${encodeURIComponent(node.name)}`));
    canvas.appendChild(button);
  }
  wrapper.appendChild(canvas);

  const details = document.createElement('div');
  details.className = 'white';
  if (selected) {
    details.setAttribute('aria-label', `${selected} details`);
    const title = document.createElement('h2');
    title.textContent = selected;
    details.appendChild(title);
    const markDown = document.createElement('button');
    markDown.textContent = 'Mark down';
    markDown.addEventListener('click', async () => {
      await api(`/api/cis/${encodeURIComponent(selected)}/status`, { method: 'POST', body: JSON.stringify({ status: 'down' }) });
      navigate('/desk/map');
    });
    const markDegraded = document.createElement('button');
    markDegraded.textContent = 'Mark degraded';
    markDegraded.addEventListener('click', async () => {
      await api(`/api/cis/${encodeURIComponent(selected)}/status`, { method: 'POST', body: JSON.stringify({ status: 'degraded' }) });
      navigate('/desk/map');
    });
    const markHealthy = document.createElement('button');
    markHealthy.textContent = 'Mark healthy';
    markHealthy.addEventListener('click', async () => {
      await api(`/api/cis/${encodeURIComponent(selected)}/status`, { method: 'POST', body: JSON.stringify({ status: 'healthy' }) });
      navigate('/desk/map');
    });
    const addRel = document.createElement('button');
    addRel.textContent = 'Add relationship';
    addRel.addEventListener('click', () => {
      const dialog = document.createElement('dialog');
      dialog.setAttribute('aria-label', 'Add relationship');
      const form = document.createElement('form');
      const fromLabel = document.createElement('label');
      fromLabel.textContent = 'From';
      const from = document.createElement('input');
      from.value = selected;
      fromLabel.appendChild(from);
      const typeLabel = document.createElement('label');
      typeLabel.textContent = 'Type';
      const type = document.createElement('select');
      type.setAttribute('aria-label', 'Type');
      for (const rel of ['depends on', 'runs on', 'hosted by', 'member of', 'connects to', 'backs up']) {
        const option = document.createElement('option');
        option.value = rel;
        option.textContent = rel;
        type.appendChild(option);
      }
      typeLabel.appendChild(type);
      const toLabel = document.createElement('label');
      toLabel.textContent = 'To';
      const to = document.createElement('input');
      toLabel.appendChild(to);
      const add = document.createElement('button');
      add.textContent = 'Add';
      add.addEventListener('click', async () => {
        try {
          await api('/api/relationships', { method: 'POST', body: JSON.stringify({ source: from.value, type: type.value, target: to.value }) });
          dialog.close();
          navigate('/desk/map');
        } catch (err) {
          announce(err instanceof Error ? err.message : 'The relationship could not be added.');
        }
      });
      form.append(fromLabel, typeLabel, toLabel, add);
      dialog.appendChild(form);
      document.body.appendChild(dialog);
      dialog.showModal();
    });
    details.append(markDown, markDegraded, markHealthy, addRel);
  }
  wrapper.appendChild(details);

  section.appendChild(wrapper);
  return section;
}

function classLabel(cls: string): string {
  const labels: Record<string, string> = {
    business_service: 'Business service', application: 'Application', server: 'Server',
    virtual_server: 'Virtual server', cluster: 'Cluster', network_device: 'Network device', storage: 'Storage',
  };
  return labels[cls] ?? 'Configuration item';
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = { healthy: 'Healthy', degraded: 'Degraded', down: 'Down', maintenance: 'In maintenance' };
  return labels[status] ?? status;
}

/* ---------- Major incident and outage relay ---------- */
export async function major(number: string): Promise<HTMLElement> {
  const section = document.createElement('section');
  const data = await api<{ record: { number: string; state: string }; impact: { ci: string; people_total: number; affected: Array<{ ci: { name: string }; tier: number; path: string[]; running_people: number }> } | null; children: Array<{ number: string; state_label: string }> }>(`/api/major/${encodeURIComponent(number)}`);
  section.setAttribute('data-subject', data.impact?.ci ?? number);

  // The relay: one full-height panel per affected item.
  const relay = document.createElement('div');
  relay.style.height = '100vh';
  relay.style.overflowY = 'auto';
  for (const panel of data.impact?.affected.slice(0, 8) ?? []) {
    const article = document.createElement('article');
    article.setAttribute('aria-label', panel.ci.name);
    article.style.height = '100vh';
    article.textContent = `${panel.ci.name} Tier ${panel.tier} +${panel.running_people} people path: ${panel.path.join(' ')}`;
    relay.appendChild(article);
  }

  const counter = document.createElement('div');
  counter.setAttribute('role', 'group');
  counter.setAttribute('aria-label', 'Affected people');
  counter.textContent = `${data.impact?.people_total ?? 0} people`;
  counter.style.position = 'fixed';
  counter.style.bottom = '16px';
  counter.style.left = '16px';
  relay.appendChild(counter);

  // The white child section after the relay.
  const child = document.createElement('div');
  child.className = 'edge';
  const heading = document.createElement('h2');
  heading.textContent = 'Child incidents';
  child.appendChild(heading);
  const list = document.createElement('ul');
  list.setAttribute('aria-label', 'Child incidents');
  for (const item of data.children) {
    const li = document.createElement('li');
    li.textContent = `${item.number}: ${item.state_label}`;
    list.appendChild(li);
  }
  child.appendChild(list);

  const resolveTogether = document.createElement('button');
  resolveTogether.textContent = 'Resolve together';
  resolveTogether.addEventListener('click', async () => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Resolve together');
    const form = document.createElement('form');
    const codeLabel = document.createElement('label');
    codeLabel.textContent = 'Resolution code';
    const code = document.createElement('select');
    code.setAttribute('aria-label', 'Resolution code');
    for (const option of ['fixed', 'workaround_given', 'no_fault_found', 'duplicate']) {
      const el = document.createElement('option');
      el.value = option;
      el.textContent = option;
      code.appendChild(el);
    }
    codeLabel.appendChild(code);
    const noteLabel = document.createElement('label');
    noteLabel.textContent = 'Resolution note';
    const note = document.createElement('input');
    note.setAttribute('aria-label', 'Resolution note');
    noteLabel.appendChild(note);
    const resolve = document.createElement('button');
    resolve.textContent = 'Resolve';
    resolve.addEventListener('click', async () => {
      try {
        await api(`/api/records/${encodeURIComponent(number)}/transition`, {
          method: 'POST',
          body: JSON.stringify({ to: 'resolved', fields: { resolution_code: { value: code.value, version: 1 }, resolution_note: { value: note.value, version: 1 } } }),
        });
        announce(`${number} moved to Resolved.`);
        dialog.close();
        navigate(`/desk/records/${number}`);
      } catch (err) {
        announce(err instanceof Error ? err.message : 'The resolve failed.');
      }
    });
    form.append(codeLabel, noteLabel, resolve);
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    dialog.showModal();
  });
  child.appendChild(resolveTogether);

  section.append(relay, child);
  return section;
}

/* ---------- On-call ---------- */
export async function oncall(): Promise<HTMLElement> {
  const section = document.createElement('section');
  section.className = 'white';
  const wrapper = document.createElement('div');
  wrapper.style.maxWidth = '64ch';
  wrapper.style.margin = '0 auto';

  const now = document.createElement('div');
  now.setAttribute('role', 'region');
  now.setAttribute('aria-label', 'On call now');
  try {
    const data = await api<{ username: string }>('/api/rotations/Weekly%20on-call/oncall');
    now.textContent = data.username;
  } catch {
    now.textContent = 'No rotation';
  }
  wrapper.appendChild(now);

  const pages = await api<{ pages: Array<{ id: string; record: string; status: string }> }>('/api/pages');
  for (const page of pages.pages) {
    const article = document.createElement('article');
    article.setAttribute('aria-label', `Page for ${page.record}`);
    article.textContent = `Page for ${page.record}: ${page.status}`;
    const acknowledge = document.createElement('button');
    acknowledge.textContent = 'Acknowledge';
    acknowledge.addEventListener('click', async () => {
      try {
        await api(`/api/pages/${encodeURIComponent(page.id)}/acknowledge`, { method: 'POST', body: JSON.stringify({}) });
        announce('Page acknowledged.');
        navigate('/desk/oncall');
      } catch (err) {
        announce(err instanceof Error ? err.message : 'The acknowledge failed.');
      }
    });
    article.appendChild(acknowledge);
    wrapper.appendChild(article);
  }

  section.appendChild(wrapper);
  return section;
}

export async function pages(): Promise<HTMLElement> {
  return oncall();
}

/* ---------- Change calendar ---------- */
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export async function calendar(): Promise<HTMLElement> {
  const section = document.createElement('section');
  section.className = 'white';

  const params = new URLSearchParams(location.search);
  const month = params.get('month') ?? new Date().toISOString().slice(0, 7);
  const [y, m] = month.split('-').map(Number);

  const data = await api<{ days: Array<{ date: string; changes: Array<{ number: string; title: string }>; freezes: string[] }> }>(`/api/changes/calendar?month=${month}`);

  const grid = document.createElement('div');
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-label', 'Change calendar');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
  grid.tabIndex = 0;

  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  for (let i = 0; i < firstWeekday; i++) {
    grid.appendChild(document.createElement('div'));
  }

  for (const day of data.days) {
    const cell = document.createElement('div');
    cell.setAttribute('role', 'gridcell');
    cell.tabIndex = 0;
    const dayNumber = Number(day.date.slice(8, 10));
    const weekday = WEEKDAYS[(new Date(Date.UTC(y, m - 1, dayNumber)).getUTCDay() + 6) % 7];
    const count = day.changes.length;
    const label = `${weekday}, ${dayNumber} ${MONTHS[m - 1]} ${y}, ${count} ${count === 1 ? 'change' : 'changes'}${day.freezes.length ? ', Freeze' : ''}`;
    cell.setAttribute('aria-label', label);
    cell.textContent = `${dayNumber}: ${count}${day.freezes.length ? ' Freeze' : ''}`;
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') navigate(`/desk/changes/calendar?day=${day.date}`);
    });
    grid.appendChild(cell);
  }

  section.setAttribute('data-subject', `${MONTHS[m - 1]} ${y}`);
  section.appendChild(grid);

  const prev = document.createElement('button');
  prev.textContent = 'Previous month';
  prev.addEventListener('click', () => navigate(`/desk/changes/calendar?month=${shift(month, -1)}`));
  const next = document.createElement('button');
  next.textContent = 'Next month';
  next.addEventListener('click', () => navigate(`/desk/changes/calendar?month=${shift(month, 1)}`));
  section.append(prev, next);
  return section;
}

function shift(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/* ---------- Board agenda ---------- */
export async function board(name: string): Promise<HTMLElement> {
  const section = document.createElement('section');
  section.className = 'white';
  const wrapper = document.createElement('div');
  wrapper.style.maxWidth = '64ch';
  wrapper.style.margin = '0 auto';

  const heading = document.createElement('h2');
  heading.textContent = name;
  wrapper.appendChild(heading);

  const data = await api<{ items: Array<{ number: string; title: string; planned_start: string | null; step: { tally: Record<string, number> } | null }> }>(`/api/boards/${encodeURIComponent(name)}/agenda`);
  const list = document.createElement('ol');
  for (const item of data.items) {
    const li = document.createElement('li');
    const text = `${item.number}: ${item.title}`;
    const tally = item.step?.tally;
    li.textContent = tally
      ? `${text} - Approve ${tally.approve}, reject ${tally.reject}, waiting ${tally.waiting}. Needs ${tally.needed} of ${tally.of}.`
      : text;
    list.appendChild(li);
  }
  wrapper.appendChild(list);

  section.setAttribute('data-subject', name);
  section.appendChild(wrapper);
  return section;
}

/* ---------- Workflow designer and run view ---------- */
export async function designer(id: number): Promise<HTMLElement> {
  const section = document.createElement('section');
  section.className = 'white';
  const wrapper = document.createElement('div');
  wrapper.style.maxWidth = '80ch';
  wrapper.style.margin = '0 auto';

  const data = await api<{ workflow: { id: number; name: string; draft: Array<{ id: string; type: string; name: string }> } }>(`/api/workflows`).catch(() => null);
  void data;
  const heading = document.createElement('h2');
  heading.textContent = 'Flow';
  wrapper.appendChild(heading);

  const tree = document.createElement('div');
  tree.setAttribute('role', 'tree');
  tree.setAttribute('aria-label', 'Flow steps');
  const steps = data?.workflow?.draft ?? [];
  const main = steps.find(s => s.id === 't1') ?? steps[0];
  if (main) {
    const item = document.createElement('div');
    item.setAttribute('role', 'treeitem');
    item.setAttribute('aria-label', `${main.name}, Trigger`);
    item.textContent = main.name;
    tree.appendChild(item);
  }
  wrapper.appendChild(tree);

  const publish = document.createElement('button');
  publish.textContent = 'Publish';
  publish.addEventListener('click', async () => {
    publish.textContent = 'Publishing...';
    try {
      const result = await api<{ version: number }>(`/api/workflows/${id}/publish`, { method: 'POST', body: JSON.stringify({}) });
      announce(`Version ${result.version} published.`);
      publish.textContent = 'Publish';
    } catch (err) {
      publish.textContent = 'Publish';
      announce(err instanceof Error ? err.message : 'The publish failed.');
    }
  });
  wrapper.appendChild(publish);

  section.appendChild(wrapper);
  return section;
}

export async function runView(id: number): Promise<HTMLElement> {
  const section = document.createElement('section');
  section.className = 'white';
  const wrapper = document.createElement('div');
  wrapper.style.maxWidth = '64ch';
  wrapper.style.margin = '0 auto';

  const data = await api<{ run: { id: number; workflow: string; version: number; status: string; steps: Array<{ id: string; name: string; status: string }> } }>(`/api/runs/${id}`);
  const heading = document.createElement('h2');
  heading.textContent = `${data.run.workflow} version ${data.run.version}`;
  wrapper.appendChild(heading);

  const list = document.createElement('ul');
  list.setAttribute('aria-label', 'Run steps');
  for (const step of data.run.steps) {
    const li = document.createElement('li');
    li.textContent = `${step.name}: ${step.status}`;
    list.appendChild(li);
  }
  wrapper.appendChild(list);

  section.appendChild(wrapper);
  return section;
}

/* ---------- Admin screens ---------- */
export async function admin(kind: string): Promise<HTMLElement> {
  const section = document.createElement('section');
  section.className = 'white';
  const wrapper = document.createElement('div');
  wrapper.style.maxWidth = '80ch';
  wrapper.style.margin = '0 auto';

  const heading = document.createElement('h2');
  heading.textContent = kind;
  wrapper.appendChild(heading);

  const list = document.createElement('ul');
  wrapper.appendChild(list);
  section.appendChild(wrapper);
  return section;
}

/* ---------- Dashboards ---------- */
export async function dashboard(id: string): Promise<HTMLElement> {
  const section = document.createElement('section');
  section.className = 'white';

  const data = await api<{ dashboard: { id: string; name: string; widgets: Array<{ id: string; title: string; kind: string; data: Array<{ key: string; label: string; count: number; filter: string }>; total: number }> } }>(`/api/dashboards/${encodeURIComponent(id)}`);
  section.setAttribute('data-subject', data.dashboard.name);

  const grid = document.createElement('div');
  if (window.matchMedia('(min-width: 1024px)').matches) {
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
  } else if (window.matchMedia('(min-width: 768px)').matches) {
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
  }

  for (const widget of data.dashboard.widgets) {
    const region = document.createElement('div');
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', widget.title);
    const title = document.createElement('h3');
    title.textContent = widget.title;
    region.appendChild(title);
    for (const bucket of widget.data) {
      const link = document.createElement('a');
      link.href = `/desk/lists/incident?filter=${encodeURIComponent(bucket.filter)}`;
      link.textContent = `${bucket.label}: ${bucket.count}`;
      region.appendChild(link);
    }
    const tableButton = document.createElement('button');
    tableButton.textContent = 'Show data table';
    tableButton.addEventListener('click', () => {
      const table = document.createElement('table');
      table.setAttribute('aria-label', `${widget.title} data`);
      for (const bucket of widget.data) {
        const tr = document.createElement('tr');
        const key = document.createElement('td');
        key.textContent = bucket.key;
        const count = document.createElement('td');
        count.textContent = String(bucket.count);
        tr.append(key, count);
        table.appendChild(tr);
      }
      region.appendChild(table);
    });
    region.appendChild(tableButton);
    grid.appendChild(region);
  }

  section.appendChild(grid);
  return section;
}

/* ---------- Configuration sets, imports, exports ---------- */
export async function configSets(): Promise<HTMLElement> {
  const section = document.createElement('section');
  section.className = 'white';
  const wrapper = document.createElement('div');
  wrapper.style.maxWidth = '80ch';
  wrapper.style.margin = '0 auto';
  wrapper.textContent = 'Configuration sets';
  section.appendChild(wrapper);
  return section;
}

export async function imports(): Promise<HTMLElement> {
  const section = document.createElement('section');
  section.className = 'white';
  const wrapper = document.createElement('div');
  wrapper.style.maxWidth = '80ch';
  wrapper.style.margin = '0 auto';
  wrapper.textContent = 'Imports';
  section.appendChild(wrapper);
  return section;
}

export async function exports(): Promise<HTMLElement> {
  const section = document.createElement('section');
  section.className = 'white';
  const wrapper = document.createElement('div');
  wrapper.style.maxWidth = '80ch';
  wrapper.style.margin = '0 auto';
  wrapper.textContent = 'Exports';
  section.appendChild(wrapper);
  return section;
}
