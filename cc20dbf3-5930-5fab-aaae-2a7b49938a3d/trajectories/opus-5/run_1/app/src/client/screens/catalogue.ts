import { request } from '../api.js';
import type { Item, LanesResponse } from '../../shared/api.js';
import { money } from '../format.js';
import type { Screen } from '../shell.js';
import { element } from '../ui/dom.js';
import { renderLanePreview } from '../ui/lanes.js';

function itemCard(item: Item, lanes: LanesResponse | null): HTMLElement {
  return element('article', { class: 'box card', 'aria-label': item.name }, [
    element('h2', {}, [
      element('a', { class: 'item-link', href: `/items/${item.id}` }, [item.name]),
    ]),
    element('div', { class: 'row-meta' }, [item.category]),
    element('div', { class: 'free-count' }, [
      `${item.units_free_today} of ${item.unit_count} free today`,
    ]),
    element('div', { class: 'mono' }, [
      item.deposit_cents === 0 ? 'No deposit' : `Deposit ${money(item.deposit_cents)}`,
    ]),
    element('div', { class: 'mono' }, [`Replacement ${money(item.replacement_cents)}`]),
    lanes === null ? null : renderLanePreview(lanes),
  ]);
}

export function catalogueScreen(): Screen {
  const list = element('div', { class: 'catalogue' });
  const node = element('div', {}, [element('h1', {}, ['Catalogue']), list]);

  void (async () => {
    const answer = await request<{ items: Item[] }>('/api/items');
    const previews = await Promise.all(
      answer.items.map(async (item) => {
        try {
          return await request<LanesResponse>(`/api/items/${item.id}/lanes`);
        } catch {
          return null;
        }
      }),
    );
    for (const [index, item] of answer.items.entries()) {
      list.appendChild(itemCard(item, previews[index] ?? null));
    }
  })();

  return { node };
}
