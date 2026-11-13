import { clear, el } from '../dom.js';
import { displayTime } from '../format.js';
import { announce, get, setLiveHandler, write, zone, type LiveMessage } from '../state.js';
import { emptyBand, loadFailed } from '../widgets.js';
import { openAddToCase } from './alerts.js';

type InboxItem = {
  id: string;
  rule: string;
  group: string;
  text: string;
  at: string;
  acknowledged_by: string | null;
};

export async function renderInbox(main: HTMLElement): Promise<void> {
  const feed = el('div', { role: 'feed', 'aria-label': 'Inbox', class: 'inbox-feed' });
  const refresh = async (): Promise<void> => {
    const data = await get<{ items: InboxItem[] }>('/api/inbox');
    clear(feed);
    if (data.items.length === 0) {
      feed.append(
        emptyBand('Nothing in the inbox.', el('a', { href: '/alerts', text: 'Alerts', 'aria-label': 'Alerts' })),
      );
      return;
    }
    for (const item of data.items) {
      const acknowledge = el('button', { type: 'button', 'aria-label': 'Acknowledge', text: 'Acknowledge' });
      acknowledge.addEventListener('click', () => {
        acknowledge.setAttribute('aria-busy', 'true');
        void (async () => {
          await write('POST', `/api/inbox/${item.id}/ack`);
          announce(`Acknowledged Group ${item.group}`);
          await refresh();
        })();
      });
      const addToCase = el('button', { type: 'button', 'aria-label': 'Add to case', text: 'Add to case' });
      addToCase.addEventListener('click', () => openAddToCase(addToCase, { inbox_item: item.id }));
      feed.append(
        el('article', { 'aria-label': item.text, class: 'card inbox-item' }, [
          el('p', { text: item.text }),
          el('p', { class: 'mono', text: displayTime(zone(), Date.parse(item.at)) }),
          item.acknowledged_by ? el('p', { text: `Acknowledged by ${item.acknowledged_by}` }) : null,
          el('div', { class: 'card-actions' }, [acknowledge, addToCase]),
        ]),
      );
    }
  };
  main.append(el('h1', { class: 'view-title', text: 'Inbox' }), feed);
  try {
    await refresh();
  } catch {
    main.append(loadFailed(() => void renderInbox(main)));
    return;
  }
  setLiveHandler((message: LiveMessage) => {
    if (message.type !== 'inbox' && message.type !== 'alert') return;
    void refresh();
  });
}
