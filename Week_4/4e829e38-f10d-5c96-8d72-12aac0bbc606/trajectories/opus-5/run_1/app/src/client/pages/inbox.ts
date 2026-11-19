import { api, type InboxItem } from '../api.js';
import { clear, el, on } from '../dom.js';
import { openDecideDialog, approvalStatusRegion } from '../decide.js';
import { onLive } from '../live.js';
import { animate, fixed2, reducedMotion } from '../motion.js';
import { navigate } from '../router.js';
import { announce, statusRegion } from '../status.js';
import { setUnread } from '../topbar.js';
import { state } from '../state.js';

export async function renderInbox(main: HTMLElement): Promise<void> {
  main.className = 'page page--inbox';
  const status = statusRegion('Inbox status');
  const approvalStatus = approvalStatusRegion();
  const list = el('ul', { class: 'inbox', 'aria-label': 'Inbox' });
  const emptyHeading = el('h2', { class: 'empty__sentence' }, 'Inbox is empty');
  const emptyHost = el('div', { class: 'empty' }, emptyHeading);
  main.append(
    el('h1', { class: 'page__title' }, 'Inbox'),
    status,
    approvalStatus,
    list,
    emptyHost,
  );

  const items = new Map<string, InboxItem>();

  const row = (item: InboxItem): HTMLElement => {
    const node = el('li', {
      class: 'inbox__item',
      'data-item': item.id,
      'data-read': item.read ? 'true' : 'false',
      tabindex: '-1',
    });
    const open = el('button', { type: 'button', class: 'inbox__open' }, item.text);
    on(open, 'click', () => void openTask(item));
    node.appendChild(open);
    if (item.kind === 'approval') {
      const decide = el('button', { type: 'button', class: 'pill pill--dark' }, 'Decide');
      on(decide, 'click', () => void decideOn(item, decide));
      node.appendChild(decide);
    }
    node.appendChild(
      el('span', { class: 'inbox__state' }, item.read ? 'Read' : 'Unread'),
    );
    return node;
  };

  const openTask = async (item: InboxItem) => {
    if (!item.taskId) return;
    const task = await api.get<{ projectId: string }>(`/api/tasks/${item.taskId}`);
    navigate(`/projects/${task.projectId}?view=list&task=${item.taskId}`);
  };

  const decideOn = async (item: InboxItem, opener: HTMLElement) => {
    if (!item.taskId) return;
    const task = await api.get<{ name: string }>(`/api/tasks/${item.taskId}`);
    openDecideDialog({ taskId: item.taskId, taskName: task.name, opener });
  };

  const refreshEmpty = () => {
    emptyHost.hidden = list.children.length > 0;
  };

  const draw = (data: { unread: number; items: InboxItem[] }) => {
    clear(list);
    items.clear();
    for (const item of data.items) {
      items.set(item.id, item);
      list.appendChild(row(item));
    }
    setUnread(data.unread);
    refreshEmpty();
  };

  draw(await api.get<{ unread: number; items: InboxItem[] }>('/api/inbox'));

  const itemNodes = (): HTMLElement[] =>
    Array.from(list.querySelectorAll<HTMLElement>('.inbox__item'));

  const focusRow = (node: HTMLElement) => {
    const target = node.querySelector<HTMLElement>('button') ?? node;
    target.focus();
  };

  on(list, 'keydown', (event) => {
    const current = (event.target as HTMLElement).closest('.inbox__item') as HTMLElement | null;
    if (!current) return;
    const nodes = itemNodes();
    const index = nodes.indexOf(current);
    const id = current.dataset.item as string;
    const item = items.get(id);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = nodes[index + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) focusRow(next);
      return;
    }
    if (event.key === 'Enter' && item) {
      event.preventDefault();
      void openTask(item);
      return;
    }
    if ((event.key === 'm' || event.key === 'M') && item) {
      event.preventDefault();
      const read = !item.read;
      void api
        .patch<InboxItem & { unread: number }>(`/api/inbox/${id}`, { read })
        .catch(() => null)
        .then((updated) => {
          if (!updated) return;
        item.read = updated.read;
        current.dataset.read = updated.read ? 'true' : 'false';
        const label = current.querySelector('.inbox__state');
        if (label) label.textContent = updated.read ? 'Read' : 'Unread';
        setUnread(updated.unread);
        announce('Inbox status', updated.read ? 'Marked as read' : 'Marked as unread');
      });
      return;
    }
    if ((event.key === 'e' || event.key === 'E') && item) {
      event.preventDefault();
      void api
        .patch<InboxItem & { unread: number }>(`/api/inbox/${id}`, { archived: true })
        .then((updated) => {
          const nodes2 = itemNodes();
          const at = nodes2.indexOf(current);
          current.remove();
          items.delete(id);
          setUnread(updated.unread);
          announce('Inbox status', 'Archived');
          const left = itemNodes();
          const next = left[at] ?? left[at - 1];
          if (next) focusRow(next);
          else emptyHeading.focus();
          refreshEmpty();
        });
    }
  });

  emptyHeading.tabIndex = -1;

  const stop = onLive((event) => {
    if (event.type === 'inbox_item' && event.personId === state.me.id) {
      const item = event.item as InboxItem;
      items.set(item.id, item);
      const node = row(item);
      node.setAttribute('data-motion', reducedMotion() ? 'settled' : 'entering');
      list.prepend(node);
      animate(
        160,
        (eased) => node.style.setProperty('--slide', `${fixed2(8 * (1 - eased))}px`),
        () => node.setAttribute('data-motion', 'settled'),
      );
      setUnread(Number(event.unread ?? state.unread));
      announce('Inbox status', `New in inbox: ${item.text}`);
      refreshEmpty();
    }
    if (event.type === 'approval_changed' && typeof event.announcement === 'string') {
      announce('Approval status', event.announcement);
    }
  });
  main.addEventListener('page:teardown', stop, { once: true });
}
