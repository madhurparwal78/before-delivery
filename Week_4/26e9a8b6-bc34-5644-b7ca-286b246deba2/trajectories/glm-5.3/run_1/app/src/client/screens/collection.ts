// Collection `/c/<slug>`: guide rows the owner can reorder by keyboard.

import { el, announceExpiring } from '../dom';
import { api } from '../api';
import { COPY } from '../../shared/copy';

interface CollectionJson {
  id: string;
  slug: string;
  title: string;
  visibility: 'public' | 'private';
  owner_name: string;
  items: { guide_id: string; title: string; slug: string; position: number }[];
}

export function renderCollection(main: HTMLElement, slug: string): void {
  main.textContent = '';
  api<CollectionJson>(`/api/collections/${slug}`).then((collection) => {
    build(main, collection);
  }).catch(() => {
    const band = el('div', { class: 'error-band' });
    band.append(el('h1', { class: 'display' }, COPY.fixed.notFound));
    band.append(el('a', { class: 'pw-btn', href: '/' }, 'Pennywasher'));
    main.append(band);
  });
}

async function build(main: HTMLElement, collection: CollectionJson): Promise<void> {
  const heading = el('h1', { class: 'display' }, collection.title);
  const byline = el('p', {}, collection.owner_name);
  const list = el('div', { role: 'list', 'aria-label': 'Guides in this collection' });
  const statusRegion = el('div', { role: 'status', 'aria-live': 'polite', 'data-status': 'collection' });
  main.append(heading, byline, statusRegion, list);

  let isOwner = false;
  try {
    const session = await api<{ user: { id: string } }>('/api/session');
    const dashboard = await api<{ collections: { id: string }[] }>('/api/dashboard');
    isOwner = dashboard.collections.some((entry) => entry.id === collection.id);
    void session;
  } catch {
    isOwner = false;
  }

  const renderRow = (item: { guide_id: string; title: string; slug: string; position: number }): void => {
    const row = el('a', { class: 'shelf-row', role: 'listitem', href: `/g/${item.slug}`, tabindex: isOwner ? '0' : '-1', 'data-guide-id': item.guide_id, 'data-position': String(item.position) }, item.title);
    if (isOwner) {
      row.addEventListener('keydown', (event) => {
        if (!event.altKey) return;
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const delta = event.key === 'ArrowUp' ? -1 : 1;
          void move(row, delta);
        }
      });
    }
    list.append(row);
  };

  const move = async (row: HTMLElement, delta: number): Promise<void> => {
    const rows = [...list.querySelectorAll('[data-guide-id]')] as HTMLElement[];
    const index = rows.indexOf(row);
    const target = index + delta;
    const title = row.textContent ?? '';
    if (target < 0) {
      announceExpiring('collection', COPY.collection.first(title));
      return;
    }
    if (target >= rows.length) {
      announceExpiring('collection', COPY.collection.last(title));
      return;
    }
    try {
      await api(`/api/collections/${collection.id}/items/${row.dataset.guide_id}/move`, {
        body: { position: target },
      });
      if (delta < 0) list.insertBefore(row, rows[target]);
      else list.insertBefore(rows[target], row);
      [...list.querySelectorAll('[data-guide-id]')].forEach((node, position) => node.setAttribute('data-position', String(position)));
      announceExpiring('collection', COPY.collection.moved(title, target));
    } catch {
      announceExpiring('collection', COPY.guide.failed);
    }
  };

  for (const item of collection.items) renderRow(item);
}
