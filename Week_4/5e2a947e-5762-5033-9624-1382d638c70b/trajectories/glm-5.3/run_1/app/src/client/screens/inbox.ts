import { el, openDialog } from '../lib/dom.js';
import { api } from '../lib/api.js';

/** dialog "Inbox": unread mentions, one link each. */
export async function openInbox(opener: HTMLElement): Promise<void> {
  openDialog({
    label: 'Inbox',
    opener,
    build(body, close) {
      void (async () => {
        body.appendChild(el('h2', {}, 'Inbox'));
        const res = await api<{ mentions: { id: string; map_id: string; topic_id: string; read: boolean }[]; unread: number }>('/api/inbox');
        if (!res.ok) return;
        const data = res.body as { mentions: { id: string; map_id: string; topic_id: string; comment_id: string; read: boolean }[]; unread: number };
        if (data.mentions.length === 0) body.appendChild(el('p', {}, 'No mentions yet.'));
        for (const m of data.mentions) {
          if (m.read) continue;
          const link = el('a', { href: `/m/${m.map_id}?topic=${m.topic_id}&comment=${m.comment_id}` }, 'Open mention');
          link.addEventListener('click', async () => {
            await api(`/api/inbox/${m.id}/read`, 'POST');
            close();
          });
          body.appendChild(link);
        }
      })();
    },
  });
}
