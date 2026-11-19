import { get, send } from '../api.js';
import { el } from '../dom.js';
import { session } from '../session.js';
import { refreshHeader } from '../shell.js';

interface InboxReply {
  unread: number;
  items: { id: string; text: string; created_at: string; read: boolean }[];
}

export async function inboxPage(host: HTMLElement): Promise<void> {
  document.body.dataset.field = 'ground';
  const region = el('section', { role: 'region', 'aria-label': 'Inbox', class: 'page inbox-page' });
  const list = el('ul', { class: 'inbox-list', 'aria-label': 'Inbox items' });
  list.setAttribute('role', 'list');
  region.append(el('h1', { text: 'Inbox' }), list);
  host.append(region);

  const res = await get<InboxReply>('/api/inbox');
  if (res.status !== 200) {
    host.append(el('h1', { class: 'empty-headline', text: 'Not found.' }));
    return;
  }
  if (res.data.items.length === 0) {
    list.append(el('li', { class: 'empty-headline', text: 'Your inbox is empty.' }));
  }
  for (const item of res.data.items) {
    list.append(el('li', { class: 'card inbox-item' }, [el('p', { text: item.text })]));
  }
  await send('POST', '/api/inbox/read');
  session.unread = 0;
  refreshHeader();
}
