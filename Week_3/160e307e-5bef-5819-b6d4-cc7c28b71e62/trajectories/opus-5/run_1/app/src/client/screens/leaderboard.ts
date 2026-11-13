import { api } from '../api.js';
import { clear, el } from '../dom.js';
import { refreshMe } from '../store.js';
import { emptyState, topbar } from './shell.js';

interface Row {
  rank: number;
  playerId: string;
  name: string;
  rating: number;
  tier: string;
  rankedGames: number;
}

function bodyRow(row: Row): HTMLElement {
  return el('tr', {}, [
    el('td', { class: 'num', text: String(row.rank) }),
    el('td', {}, [el('a', { href: `/profile/${encodeURIComponent(row.name)}`, text: row.name })]),
    el('td', { class: 'num', text: row.rating.toFixed(2) }),
    el('td', { text: row.tier }),
  ]);
}

export async function renderLeaderboard(_params: Record<string, string>, view: HTMLElement): Promise<void> {
  await refreshMe();
  let data: { rows: Row[]; you: Row | null } = { rows: [], you: null };
  try {
    data = await api.get<{ rows: Row[]; you: Row | null }>('/api/leaderboard');
  } catch {
    data = { rows: [], you: null };
  }

  const inTable = data.you !== null && data.rows.some((row) => row.playerId === data.you?.playerId);
  const table = el('table', { 'aria-label': 'Leaderboard' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Rank' }),
        el('th', { scope: 'col', text: 'Name' }),
        el('th', { scope: 'col', text: 'Rating' }),
        el('th', { scope: 'col', text: 'Tier' }),
      ]),
    ]),
    el('tbody', {}, data.rows.map(bodyRow)),
  ]);

  clear(view);
  view.append(
    el('div', {}, [
      topbar(),
      el('section', { class: 'field field--ground' }, [
        el('h1', { class: 'display', text: 'Leaderboard', style: 'font-size: var(--step-4)' }),
        data.rows.length === 0
          ? emptyState('NO RANKED PLAYERS YET', { href: '/', label: 'Play your first match' })
          : table,
        ...(data.you !== null && !inTable
          ? [
              el('div', { class: 'surface', style: 'margin-top:1rem' }, [
                el('p', { class: 'num', text: `${data.you.rank}. ${data.you.name} ${data.you.rating.toFixed(2)} ${data.you.tier}` }),
              ]),
            ]
          : []),
      ]),
    ]),
  );
}
