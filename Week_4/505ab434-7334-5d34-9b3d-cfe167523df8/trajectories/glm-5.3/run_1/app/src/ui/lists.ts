import { api, el, loadMe, type Me, type RequestDetail, type QueueRow, formatDateTime } from './types';

export async function initRequests(): Promise<void> {
  const me: Me | null = await loadMe();
  const root = document.getElementById('requests-root');
  if (!root) return;
  const data = await api<{ requests: RequestDetail[] }>('/api/requests');
  if (data.requests.length === 0) {
    root.replaceChildren(
      el('div', { class: 'empty-cell field-stone' }, el('p', {}, 'You have no requests yet.')),
    );
    return;
  }
  const table = el('table', { class: 'data', 'aria-label': 'My requests' });
  const head = el('thead');
  head.append(
    el('tr', {},
      el('th', { scope: 'col' }, 'Request'),
      el('th', { scope: 'col' }, 'Asset'),
      el('th', { scope: 'col' }, 'Application'),
      el('th', { scope: 'col' }, 'State'),
      el('th', { scope: 'col' }, 'Due'),
    ),
  );
  const body = el('tbody');
  for (const request of data.requests) {
    body.append(
      el('tr', {},
        el('td', {}, el('a', { href: `/requests/${request.id}` }, request.id)),
        el('td', {}, request.cardName),
        el('td', {}, request.applicationLabel),
        el('td', {}, request.stateLabel),
        el('td', {}, request.deadline ? formatDateTime(request.deadline) : ''),
      ),
    );
  }
  table.append(head, body);
  root.replaceChildren(table);
  void me;
}

export async function initQueue(): Promise<void> {
  const me: Me | null = await loadMe();
  const root = document.getElementById('queue-root');
  if (!root) return;
  const status = el('p', { id: 'queue-updates', role: 'status', 'aria-live': 'polite', class: 'sr-only' });
  root.before(status);

  const load = async (): Promise<void> => {
    const data = await api<{ rows: QueueRow[] }>('/api/queue');
    const known = new Set(currentIds(root));
    if (data.rows.length === 0 && !root.querySelector('.empty-cell')) {
      root.replaceChildren(el('div', { class: 'empty-cell field-stone' }, el('p', {}, 'Nothing is waiting for you.')));
      return;
    }
    if (data.rows.length === 0) return;
    const phone = window.innerWidth < 768;
    root.replaceChildren(phone ? queueCards(data.rows) : queueTable(data.rows));
    const nowIds = new Set(data.rows.map((row) => row.requestId));
    for (const id of nowIds) {
      if (!known.has(id)) status.textContent = `${id} added to your queue.`;
    }
    for (const id of known) {
      if (!nowIds.has(id)) status.textContent = `${id} left your queue.`;
    }
  };

  window.addEventListener('rulehouse:queue-updated', () => void load());
  window.addEventListener('rulehouse:library-updated', () => void load());
  await load();
  void me;
}

function currentIds(root: HTMLElement): string[] {
  return [...Array.from(root.querySelectorAll('a'))]
    .map((link) => /\/requests\/(.+)$/.exec(link.getAttribute('href') ?? '')?.[1])
    .filter((value): value is string => Boolean(value));
}

function queueTable(rows: QueueRow[]): HTMLElement {
  const table = el('table', { class: 'data', 'aria-label': 'Review queue' });
  const head = el('thead');
  head.append(
    el('tr', {},
      el('th', { scope: 'col' }, 'Request'),
      el('th', { scope: 'col' }, 'Asset'),
      el('th', { scope: 'col' }, 'Application'),
      el('th', { scope: 'col' }, 'Requester'),
      el('th', { scope: 'col' }, 'Stage'),
      el('th', { scope: 'col' }, 'Due'),
    ),
  );
  const body = el('tbody');
  for (const row of rows) {
    body.append(
      el('tr', {},
        el('td', {}, el('a', { href: `/requests/${row.requestId}` }, row.requestId)),
        el('td', {}, row.cardName),
        el('td', {}, row.applicationLabel),
        el('td', {}, `${row.requesterName} (${row.organisationName})`),
        el('td', {}, row.stageLabel),
        el('td', {}, `Due ${formatDateTime(row.deadline)}`),
      ),
    );
  }
  table.append(head, body);
  return table;
}

function queueCards(rows: QueueRow[]): HTMLElement {
  const list = el('div', { class: 'queue-cards', role: 'list', 'aria-label': 'Review queue' });
  for (const row of rows) {
    list.append(
      el('div', { class: 'queue-card', role: 'listitem' },
        el('a', { href: `/requests/${row.requestId}` }, row.requestId),
        el('p', {}, row.cardName),
        el('p', {}, row.applicationLabel),
        el('p', {}, `${row.requesterName} (${row.organisationName})`),
        el('p', {}, row.stageLabel),
        el('p', {}, `Due ${formatDateTime(row.deadline)}`),
      ),
    );
  }
  return list;
}
