import { getJson } from '../api.js';
import { el } from '../dom.js';
import { onLive } from '../live.js';
import { emptyGlyph } from '../marks.js';
import { registerCleanup, type PageContext } from '../main.js';
import { displayDateTime } from '../shell.js';
import type { QueueRow } from '../../shared/types.js';

const COLUMNS = ['Request', 'Asset', 'Application', 'Requester', 'Stage', 'Due'];

export async function renderQueue(context: PageContext): Promise<void> {
  const { main, navigate } = context;
  const updates = el('p', {
    class: 'results-status',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Queue updates',
  });
  const holder = el('div', { class: 'cell queue-cell' });
  main.append(updates, holder);

  let rows: QueueRow[] = [];

  const link = (row: QueueRow): HTMLElement =>
    el(
      'a',
      {
        href: `/requests/${row.requestId}`,
        onclick: (event: Event) => {
          event.preventDefault();
          navigate(`/requests/${row.requestId}`);
        },
      },
      row.requestId,
    );

  const paint = (): void => {
    if (rows.length === 0) {
      holder.replaceChildren(
        el('div', { class: 'field field-ember empty-state' }, emptyGlyph(), el('p', {}, 'Nothing is waiting for you.')),
      );
      return;
    }

    if (window.innerWidth >= 768) {
      holder.replaceChildren(
        el(
          'table',
          { class: 'data-table queue-table' },
          el('caption', {}, 'Review queue'),
          el('thead', {}, el('tr', {}, ...COLUMNS.map((column) => el('th', { scope: 'col' }, column)))),
          el(
            'tbody',
            {},
            ...rows.map((row) =>
              el(
                'tr',
                {},
                el('th', { scope: 'row' }, link(row)),
                el('td', {}, row.cardName),
                el('td', {}, row.applicationLabel),
                el('td', {}, `${row.requesterName}, ${row.organisationName}`),
                el('td', {}, row.stageLabel),
                el(
                  'td',
                  {},
                  `Due ${displayDateTime(row.deadline)}`,
                  row.escalation === 'deadline_missed' ? el('span', { class: 'escalation' }, ' Escalated: deadline missed') : null,
                  row.escalation === 'no_eligible_reviewer'
                    ? el('span', { class: 'escalation' }, ' Escalated: no eligible reviewer')
                    : null,
                ),
              ),
            ),
          ),
        ),
      );
      return;
    }

    holder.replaceChildren(
      el(
        'ul',
        { class: 'queue-cards', 'aria-label': 'Review queue' },
        ...rows.map((row) =>
          el(
            'li',
            { class: 'queue-card' },
            el('p', {}, link(row)),
            el('p', {}, row.cardName),
            el('p', {}, row.applicationLabel),
            el('p', {}, `${row.requesterName}, ${row.organisationName}`),
            el('p', {}, row.stageLabel),
            el('p', {}, `Due ${displayDateTime(row.deadline)}`),
            row.escalation === 'deadline_missed' ? el('p', { class: 'escalation' }, 'Escalated: deadline missed') : null,
            row.escalation === 'no_eligible_reviewer'
              ? el('p', { class: 'escalation' }, 'Escalated: no eligible reviewer')
              : null,
          ),
        ),
      ),
    );
  };

  const load = async (announce: boolean): Promise<void> => {
    const previous = new Set(rows.map((row) => row.requestId));
    const response = await getJson<{ rows: QueueRow[] }>('/api/queue');
    rows = response.rows;
    if (announce) {
      const now = new Set(rows.map((row) => row.requestId));
      for (const requestId of now) {
        if (!previous.has(requestId)) updates.textContent = `${requestId} added to your queue.`;
      }
      for (const requestId of previous) {
        if (!now.has(requestId)) updates.textContent = `${requestId} left your queue.`;
      }
    }
    paint();
  };

  await load(false);

  const onResize = (): void => paint();
  window.addEventListener('resize', onResize);
  registerCleanup(() => window.removeEventListener('resize', onResize));
  registerCleanup(
    onLive((event) => {
      if (event.type === 'queue.updated' || event.type === 'request.updated') void load(true);
    }),
  );
}
