import { api } from '../api.ts';
import { districtCounters } from '../counters.ts';
import { el, renderWhenChanged } from '../dom.ts';
import type { Screen } from '../screen.ts';
import { dataRow, dataTable } from '../table.ts';
import type { PackRecord } from '../types.ts';

/** The clerk's packs. */

export async function packsScreen(): Promise<Screen> {
  const counters = districtCounters();
  const table = dataTable('Packs', ['Pack', 'Period', 'State', 'Signatory', 'Created']);

  const element = el('main', {
    class: 'page',
    children: [
      counters.element,
      el('h1', { text: 'Delivery packs' }),
      el('p', { children: [el('a', { text: 'New pack', attrs: { href: '/packs/new' } })] }),
      el('section', { class: 'card', children: [table.element] }),
    ],
  });

  const refresh = async (): Promise<void> => {
    await counters.refresh();
    const reply = await api.get<{ packs: PackRecord[] }>('/api/packs');
    const signature = reply.packs.map((pack) => [pack.number, pack.state, pack.from, pack.to].join('|')).join('\u0001');
    renderWhenChanged(table.body, signature, () => {
      for (const pack of reply.packs) {
        table.body.appendChild(
          dataRow([
            { label: 'Pack', content: el('a', { text: pack.number, attrs: { href: `/packs/${pack.number}` } }) },
            { label: 'Period', content: `${pack.from} to ${pack.to}` },
            { label: 'State', content: pack.state },
            { label: 'Signatory', content: pack.signatory },
            { label: 'Created', content: pack.created_at },
          ]),
        );
      }
    });
  };

  await refresh();
  return { element, refresh };
}
