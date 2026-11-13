import { api } from '../api.ts';
import { clear, h } from '../dom.ts';
import type { Screen } from './documents.ts';

const stamp = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;

export const auditScreen = (documentId: string): Screen => {
  const body = h('tbody');
  const hashLine = h('p', { class: 'hash-line', hidden: true });
  const table = h(
    'table',
    { 'aria-label': 'Audit trail', class: 'audit-table' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { scope: 'col' }, '#'),
        h('th', { scope: 'col' }, 'Event'),
        h('th', { scope: 'col' }, 'By'),
        h('th', { scope: 'col' }, 'Time (UTC)'),
        h('th', { scope: 'col' }, 'Hash'),
      ),
    ),
    body,
  );

  const root = h(
    'div',
    { class: 'audit-screen' },
    h('h1', { class: 'page-heading' }, 'Audit trail'),
    h('a', { href: `/documents/${documentId}` }, 'Back to the document'),
    hashLine,
    table,
  );

  void (async () => {
    const [events, document_] = await Promise.all([
      api.audit(documentId),
      api.document(documentId),
    ]);
    clear(body);
    for (const event of events) {
      body.appendChild(
        h(
          'tr',
          {},
          h('td', { class: 'mono' }, String(event.seq)),
          h('td', {}, event.type),
          h('td', {}, event.actor),
          h('td', { class: 'mono' }, stamp(event.at)),
          h('td', { class: 'mono hash-cell', title: event.hash }, event.hash.slice(0, 12)),
        ),
      );
    }
    if (document_.status === 'completed' && document_.completedSha256 !== null) {
      hashLine.hidden = false;
      clear(hashLine);
      hashLine.append(
        'Completed PDF SHA-256 ',
        h('span', { class: 'mono' }, document_.completedSha256),
      );
    }
  })();

  return { root, destroy: () => undefined };
};
