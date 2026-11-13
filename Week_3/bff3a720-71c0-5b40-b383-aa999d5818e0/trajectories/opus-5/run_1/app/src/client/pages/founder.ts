import { announce, setAlert, withPending } from '../announce.js';
import { api } from '../api.js';
import { copy } from '../copy.js';
import { clear, focus, h } from '../dom.js';
import { timeLabel } from '../../shared/zoned.js';
import { connectLive } from '../live.js';
import { plate } from '../plates.js';
import { onLeave, type RouteContext } from '../router.js';
import { mainRegion } from '../shell.js';
import { currentMember, isFounder } from '../state.js';
import { openDialog } from '../components/dialog.js';
import type { Member } from '../state.js';

interface ReviewDocument {
  id: string;
  member: Member;
  file_id: string;
  uploaded_at: string;
}

interface OutboxItem {
  id: string;
  kind: string;
  to: string;
  subject: string;
  status: string;
  attempts: number;
  last_attempt_at: string | null;
}

function forbidden(main: HTMLElement): void {
  clear(main);
  main.append(
    h('h1', { text: 'Longseat' }),
    h('div', { role: 'alert', class: 'outage', text: 'You do not have access to this.' }),
  );
}

export function renderIdReview(_ctx: RouteContext): void {
  const main = mainRegion();
  clear(main);
  if (!isFounder(currentMember())) {
    forbidden(main);
    return;
  }
  const heading = h('h1', { text: 'ID review' });
  const queueBox = h('div', { class: 'queue-box' });
  main.append(heading, queueBox);
  focus(heading);

  const load = async () => {
    const result = await api<{ documents: ReviewDocument[] }>(
      'GET',
      '/api/founder/id-reviews',
    );
    clear(queueBox);
    if (!result.ok) return;
    if (result.data.documents.length === 0) {
      queueBox.append(
        plate({
          seed: 'review-empty',
          leg: 'Oakhythe to Saint Ivrel',
          kind: 'fields',
          ratio: 1,
          className: 'plate-empty',
        }),
        h('p', { class: 'empty-line', text: copy.emptyReview }),
      );
      return;
    }
    const list = h('ul', { 'aria-label': 'ID review queue', class: 'queue' });
    for (const document of result.data.documents) {
      const item = h('li', { 'data-id': document.id, class: 'queue-item' });
      const slot = h('div', { class: 'alert-slot' });
      const approve = h('button', {
        type: 'button',
        class: 'secondary',
        text: `Approve ${document.member.display_name}`,
      });
      approve.addEventListener('click', () => {
        void (async () => {
          const outcome = await withPending(approve, () =>
            api<{ id_state: string }>(
              'POST',
              `/api/founder/id-reviews/${document.id}/approve`,
            ),
          );
          if (!outcome) return;
          if (!outcome.ok) {
            setAlert(slot, outcome.failure.message);
            return;
          }
          announce(copy.founderVerified(document.member.display_name));
          await load();
        })();
      });
      const ask = h('button', {
        type: 'button',
        class: 'secondary',
        text: `Ask ${document.member.display_name} to upload again`,
      });
      ask.addEventListener('click', () => {
        openDialog({
          name: 'Ask for a new upload',
          opener: ask,
          build: ({ close }) => {
            const reason = h('input', {
              type: 'text',
              'aria-label': 'Reason',
              class: 'field',
            });
            const dialogSlot = h('div', { class: 'alert-slot' });
            const send = h('button', {
              type: 'button',
              class: 'secondary',
              text: 'Send request',
            });
            send.addEventListener('click', () => {
              void (async () => {
                const outcome = await withPending(send, () =>
                  api<{ id_state: string }>(
                    'POST',
                    `/api/founder/id-reviews/${document.id}/reject`,
                    { body: { reason: reason.value } },
                  ),
                );
                if (!outcome) return;
                if (!outcome.ok) {
                  setAlert(dialogSlot, outcome.failure.message);
                  return;
                }
                close();
                announce(copy.founderAskedAgain(document.member.display_name));
                await load();
              })();
            });
            return [
              h('span', { class: 'label', text: 'Reason' }),
              reason,
              send,
              dialogSlot,
            ];
          },
        });
      });
      item.append(
        h('a', {
          href: `/api/files/${document.file_id}`,
          text: `View document for ${document.member.display_name}`,
          target: '_blank',
          rel: 'noreferrer',
        }),
        approve,
        ask,
        slot,
      );
      list.appendChild(item);
    }
    queueBox.appendChild(list);
  };

  void load();
  const connection = connectLive({
    onHello: () => void load(),
    onEvent: () => void load(),
  });
  onLeave(() => connection.close());
}

export function renderNetwork(_ctx: RouteContext): void {
  const main = mainRegion();
  clear(main);
  if (!isFounder(currentMember())) {
    forbidden(main);
    return;
  }
  const heading = h('h1', { text: 'Network' });
  const outboxBox = h('div', { class: 'outbox-box' });
  const statesBox = h('div', { class: 'states-box' });
  main.append(heading, outboxBox, statesBox);
  focus(heading);

  const load = async () => {
    const [outbox, states] = await Promise.all([
      api<{ items: OutboxItem[] }>('GET', '/api/founder/outbox'),
      api<{ counts: Record<string, number> }>('GET', '/api/founder/bookings-by-state'),
    ]);
    clear(outboxBox);
    clear(statesBox);
    if (outbox.ok) {
      const table = h('table', { 'aria-label': 'Outbox', class: 'table' });
      const head = h('tr', {});
      for (const column of ['Kind', 'To', 'Subject', 'Status', 'Attempts', 'Last attempt']) {
        head.appendChild(h('th', { scope: 'col', text: column }));
      }
      table.appendChild(h('thead', {}, head));
      const body = h('tbody', {});
      for (const item of outbox.data.items) {
        const row = h('tr', { 'data-id': item.id });
        const cells: Array<[string, string]> = [
          ['Kind', item.kind],
          ['To', item.to],
          ['Subject', item.subject],
          ['Status', item.status],
          ['Attempts', String(item.attempts)],
          ['Last attempt', item.last_attempt_at ? timeLabel(item.last_attempt_at) : '\u2014'],
        ];
        for (const [label, value] of cells) {
          row.appendChild(h('td', { 'data-label': label, text: value }));
        }
        body.appendChild(row);
      }
      table.appendChild(body);
      outboxBox.appendChild(table);
    }
    if (states.ok) {
      const table = h('table', { 'aria-label': 'Bookings by state', class: 'table' });
      const head = h('tr', {});
      for (const column of ['State', 'Bookings']) {
        head.appendChild(h('th', { scope: 'col', text: column }));
      }
      table.appendChild(h('thead', {}, head));
      const body = h('tbody', {});
      for (const [state, count] of Object.entries(states.data.counts)) {
        const row = h('tr', { 'data-id': state });
        row.append(
          h('td', { 'data-label': 'State', text: state }),
          h('td', { 'data-label': 'Bookings', text: String(count) }),
        );
        body.appendChild(row);
      }
      table.appendChild(body);
      statesBox.appendChild(table);
    }
  };

  void load();
  const connection = connectLive({
    onHello: () => void load(),
    onEvent: () => void load(),
  });
  onLeave(() => connection.close());
}
