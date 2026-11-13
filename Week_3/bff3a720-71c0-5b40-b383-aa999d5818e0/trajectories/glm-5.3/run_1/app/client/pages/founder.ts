import { h, clear } from '../lib/els.js';
import { store } from '../lib/store.js';
import { api, ApiFail } from '../lib/api.js';
import { announce } from '../lib/announce.js';
import { openDialog } from '../lib/dialog.js';
import { plate } from '../lib/plates.js';
import { hhmm, shortDate } from '../lib/fmt.js';
import { live } from '../lib/live.js';
import type { Member, OutboxItem } from '../lib/types.js';

export async function founderIdReviewPage(): Promise<HTMLElement> {
  const root = h('div');
  if (!store.isFounder()) {
    root.append(h('h1', null, 'ID review'), h('div', { role: 'alert', class: 'banner-outage' }, 'You do not have access to this.'));
    return root;
  }
  const list = h('ul', { role: 'list', 'aria-label': 'ID review queue', class: 'list-plain' });

  const render = async (): Promise<void> => {
    clear(list);
    try {
      const data = await api<{ documents: Array<{ id: string; member: Member; file_id: string | null; uploaded_at: string }> }>('GET', '/api/founder/id-reviews');
      if (data.documents.length === 0) {
        list.append(h('li', null, 'No documents are waiting for review.'));
        root.querySelector('.empty-sentence')?.remove();
        root.append(h('div', { class: 'empty' },
          h('div', { class: 'plate plate-square' }, plate({ seed: 'empty-review', caption: 'Empty queue', ratio: '1 / 1' })),
          h('p', { class: 'empty-sentence' }, 'No documents are waiting for review.'),
        ));
        return;
      }
      for (const d of data.documents) {
        const row = h('li', { 'data-id': d.id },
          h('span', null, `${d.member.display_name}`),
          h('a', { href: d.file_id ? `/api/files/${d.file_id}` : '#', target: '_blank', rel: 'noopener' }, `View document for ${d.member.display_name}`),
          h('button', { type: 'button', class: 'btn', onClick: async () => {
            btn.textContent = 'Working';
            try {
              await api('POST', `/api/founder/id-reviews/${d.id}/approve`, {});
              announce(`${d.member.display_name} is verified.`);
              await render();
            } catch (e) {
              if (e instanceof ApiFail) announce(e.body.message);
              btn.textContent = `Approve ${d.member.display_name}`;
            }
          } }, `Approve ${d.member.display_name}`),
          h('button', { type: 'button', class: 'btn', onClick: () => openReject(d) }, `Ask ${d.member.display_name} to upload again`),
        );
        const btn = row.querySelectorAll('button')[0] as HTMLButtonElement;
        void btn;
        list.append(row);
      }
    } catch {
      list.append(h('li', null, 'You do not have access to this.'));
    }
  };

  const openReject = (d: { id: string; member: Member }): void => {
    const input = h('input', { type: 'text', class: 'field', 'aria-label': 'Reason' }) as HTMLInputElement;
    const send = h('button', {
      type: 'button', class: 'btn primary', 'data-autofocus': true,
      onClick: async () => {
        send.textContent = 'Working';
        try {
          await api('POST', `/api/founder/id-reviews/${d.id}/reject`, { reason: input.value.trim() });
          announce(`${d.member.display_name} was asked to upload again.`);
          dialog.close();
          await render();
        } catch (e) {
          if (e instanceof ApiFail) announce(e.body.message);
          send.textContent = 'Send request';
        }
      },
    }, 'Send request');
    const dialog = openDialog({ label: 'Ask for a new upload' }, [h('label', null, 'Reason'), input, send]);
    void dialog;
  };

  live.setHandlers({ onHello: () => { void render(); } });
  live.subscribe(null, null);

  root.append(h('h1', null, 'ID review'), list);
  await render();
  return root;
}

export async function founderNetworkPage(): Promise<HTMLElement> {
  const root = h('div');
  if (!store.isFounder()) {
    root.append(h('h1', null, 'Network'), h('div', { role: 'alert', class: 'banner-outage' }, 'You do not have access to this.'));
    return root;
  }
  const outboxTable = h('table', { 'aria-label': 'Outbox' });
  const countsTable = h('table', { 'aria-label': 'Bookings by state' });

  const render = async (): Promise<void> => {
    try {
      const outbox = await api<{ items: OutboxItem[] }>('GET', '/api/founder/outbox');
      clear(outboxTable);
      outboxTable.append(h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Kind'), h('th', { scope: 'col' }, 'To'), h('th', { scope: 'col' }, 'Subject'),
        h('th', { scope: 'col' }, 'Status'), h('th', { scope: 'col' }, 'Attempts'), h('th', { scope: 'col' }, 'Last attempt'))));
      const tbody = h('tbody');
      for (const item of outbox.items) {
        tbody.append(h('tr', { 'data-id': item.id },
          h('td', { 'data-label': 'Kind' }, item.kind.replace(/_/g, ' ')),
          h('td', { 'data-label': 'To' }, item.to),
          h('td', { 'data-label': 'Subject' }, item.subject),
          h('td', { 'data-label': 'Status' }, item.status),
          h('td', { 'data-label': 'Attempts' }, String(item.attempts)),
          h('td', { 'data-label': 'Last attempt' }, item.last_attempt_at ? `${shortDate(item.last_attempt_at)} ${hhmm(item.last_attempt_at)}` : ''),
        ));
      }
      outboxTable.append(tbody);
    } catch { /* keep */ }

    try {
      const counts = await api<{ counts: Record<string, number> }>('GET', '/api/founder/bookings-by-state');
      clear(countsTable);
      const thead = h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'State'), h('th', { scope: 'col' }, 'Bookings')));
      const tbody = h('tbody');
      for (const [state, n] of Object.entries(counts.counts)) {
        tbody.append(h('tr', null, h('td', { 'data-label': 'State' }, state.replace(/_/g, ' ')), h('td', { 'data-label': 'Bookings' }, String(n))));
      }
      countsTable.append(thead, tbody);
    } catch { /* keep */ }
  };

  live.setHandlers({ onHello: () => { void render(); } });
  live.subscribe(null, null);

  root.append(h('h1', null, 'Network'), h('h2', null, 'Outbox'), outboxTable, h('h2', { class: 'section-2' }, 'Bookings by state'), countsTable);
  await render();
  return root;
}
