import { get, post } from '../api';
import { collectionStatus } from '../../shared/copy';
import type { User } from '../../shared/types';
import { h } from '../dom';
import { Status } from '../status';

interface CollectionBody {
  title: string; owner_name: string; items: { guide_id: string; title: string; slug: string; position: number }[];
}

export async function mountCollection(root: HTMLElement, id: string, ownerId: string, user: User | null): Promise<void> {
  const owner = user?.id === ownerId;
  const status = new Status('Collection status', 'status');
  const list = h('ul', { 'aria-label': 'Guides in this collection', class: 'collection-rows' });
  const title = h('h1', { class: 'page-title' });
  root.append(h('main', { class: 'collection-page' }, h('a', { class: 'wordmark', href: '/' }, 'Pennywasher'), title, status.element, list));
  const body = await get<CollectionBody>(`/api/collections/${id}`);
  title.textContent = body.title;
  let order = body.items.map((item) => item.guide_id);
  const rows = new Map(body.items.map((item) => [item.guide_id, h('li', { class: 'collection-row', tabindex: owner ? 0 : undefined, 'data-guide': item.guide_id }, h('a', { href: `/g/${item.slug}` }, item.title))]));
  const titles = new Map(body.items.map((item) => [item.guide_id, item.title]));
  const paint = () => list.replaceChildren(...order.map((guide) => rows.get(guide)!));
  paint();
  if (!owner) return;
  list.addEventListener('keydown', async (event) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>('.collection-row');
    if (!row) return;
    event.preventDefault();
    const guide = row.dataset.guide!;
    const index = order.indexOf(guide);
    const name = titles.get(guide)!;
    const to = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (to < 0) return status.set(collectionStatus.first(name));
    if (to >= order.length) return status.set(collectionStatus.last(name));
    const moved = await post<{ order: string[] }>(`/api/collections/${id}/items/${guide}/move`, { position: to + 1 });
    order = moved.order;
    paint();
    row.focus();
    status.set(collectionStatus.moved(name, to + 1));
  });
}
