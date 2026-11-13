import { send } from '../api';
import { clear, el } from '../dom';
import { emptyState, thumbnail } from '../ui';

type DashboardAnswer = {
  parts: {
    slug: string;
    title: string;
    visibility: string;
    likes: number;
    head: { id: string; label: string } | null;
    revisionCount: number;
  }[];
  rooms: {
    id: string;
    title: string;
    partSlug: string;
    state: string;
    approvals: number;
    requiredApprovals: number;
  }[];
  liked: { slug: string; title: string; author: string }[];
};

export async function mountDashboard(host: HTMLElement): Promise<void> {
  const answer = await send<DashboardAnswer>('/api/dashboard');
  clear(host);

  const myParts = el('section', { role: 'region', 'aria-label': 'My parts' }, [
    el('h2', { class: 'section-title' }, ['My parts']),
  ]);
  if (answer.data.parts.length === 0) {
    myParts.append(
      emptyState('You have no parts yet.', el('a', { href: '/' }, ['Browse the gallery'])),
    );
  } else {
    const list = el('ul', { class: 'row-list' });
    for (const part of answer.data.parts) {
      list.append(
        el('li', { class: 'row' }, [
          thumbnail(null, part.title),
          el('a', { href: `/parts/${part.slug}` }, [part.title]),
          el('span', { class: 'muted' }, [
            ` · ${part.head?.label ?? 'r1'} · ${part.revisionCount} revisions`,
          ]),
        ]),
      );
    }
    myParts.append(list);
  }

  const rooms = el('section', { role: 'region', 'aria-label': 'Review rooms' }, [
    el('h2', { class: 'section-title' }, ['Review rooms']),
  ]);
  if (answer.data.rooms.length === 0) {
    rooms.append(emptyState('No review rooms yet.', null));
  } else {
    const list = el('ul', { class: 'row-list' });
    for (const room of answer.data.rooms) {
      const state = room.state === 'approved' ? 'Approved' : room.state === 'closed' ? 'Closed' : 'Open';
      list.append(
        el('li', { class: 'row' }, [
          el('a', { href: `/rooms/${room.id}` }, [room.title]),
          el('span', { class: 'muted' }, [
            ` · ${state} · Approvals ${room.approvals} of ${room.requiredApprovals}`,
          ]),
        ]),
      );
    }
    rooms.append(list);
  }

  const liked = el('section', { role: 'region', 'aria-label': 'Liked parts' }, [
    el('h2', { class: 'section-title' }, ['Liked parts']),
  ]);
  if (answer.data.liked.length === 0) {
    liked.append(emptyState('You have not liked any parts yet.', null));
  } else {
    const list = el('ul', { class: 'row-list' });
    for (const part of answer.data.liked) {
      list.append(
        el('li', { class: 'row' }, [
          el('a', { href: `/parts/${part.slug}` }, [part.title]),
          el('span', { class: 'muted' }, [` · ${part.author}`]),
        ]),
      );
    }
    liked.append(list);
  }

  host.append(myParts, rooms, liked);
}
