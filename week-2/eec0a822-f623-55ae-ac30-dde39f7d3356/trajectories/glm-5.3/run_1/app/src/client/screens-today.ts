import { api } from './api.js';
import { h } from './ui.js';
import { member } from './shell.js';

export async function todayScreen(ws: string): Promise<HTMLElement> {
  const isCrew = member!.role === 'crew_member';
  const yachtsData = await api<any>(`/api/w/${ws}/yachts`);
  const yachts = isCrew ? yachtsData.yachts.filter((y: any) => y.slug === member!.yachtSlug) : yachtsData.yachts;
  const links = h('ul', { 'aria-label': 'Your yachts', style: 'list-style:none;padding:0' });
  for (const y of yachts) {
    const row = h('li', { class: 'card', style: 'display:flex;gap:0.8rem;align-items:center;flex-wrap:wrap' },
      h('strong', {}, y.name),
      h('a', { href: `/w/${ws}/yachts/${y.slug}/rota` }, 'Rota'),
      h('a', { href: `/w/${ws}/passages?yachtSlug=${y.slug}` }, 'Passages'),
      h('a', { href: `/w/${ws}/yachts/${y.slug}/stores` }, 'Stores'),
    );
    if (member!.role === 'captain' || member!.role === 'fleet_director') {
      row.append(h('a', { href: `/w/${ws}/yachts/${y.slug}/energy` }, 'Energy'));
    }
    links.append(row);
  }
  const upcoming = h('ul', { 'aria-label': 'Upcoming passages', style: 'list-style:none;padding:0' });
  const passages = await api<any>(`/api/w/${ws}/passages`);
  const today = Date.now();
  const sent = passages.passages.filter((p: any) => Date.parse(p.departsAt) >= today);
  for (const p of sent.slice(0, 10)) {
    upcoming.append(h('li', { class: 'card' },
      h('a', { href: `/w/${ws}/passages/${p.id}` }, p.name),
      h('span', { class: 'num', style: 'margin-left:0.6rem' }, `${p.yachtSlug}`),
    ));
  }
  if (sent.length === 0) {
    upcoming.append(h('li', { class: 'empty' }, 'No passages yet.'));
  }
  return h('div', {},
    h('h1', {}, 'Today'),
    h('h2', {}, 'Your yachts'),
    links,
    h('h2', {}, 'Upcoming passages'),
    upcoming,
  );
}
