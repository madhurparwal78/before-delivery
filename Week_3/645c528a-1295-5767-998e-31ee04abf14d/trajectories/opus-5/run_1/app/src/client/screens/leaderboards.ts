import { CLUB_COPY, num } from '../../shared/copy.js';
import { api } from '../api.js';
import { clear, el, statusRegion } from '../dom.js';
import { type Screen } from '../navigate.js';
import { state } from '../state.js';

const SCOPES = ['Global', 'Friends', 'Club'] as const;
type Scope = (typeof SCOPES)[number];

interface BoardBody {
  rows: { rank: number; playerId: string; displayName: string; wins: number }[];
  own: { rank: number | null; wins: number };
}

export function leaderboardScreen(): Screen {
  const tablist = el('div', { className: 'tablist', attrs: { role: 'tablist', 'aria-label': 'Scope' } });
  const table = el('table', { className: 'board', attrs: { 'aria-label': 'Weekly wins' } });
  const tbody = el('tbody');
  const emptyNotice = el('p', { className: 'notice' });
  const ownRank = el('div', { className: 'own-rank', attrs: { role: 'region', 'aria-label': 'Your rank' } });
  const ownText = statusRegion('Own rank', 'notice');
  ownRank.append(ownText);
  let active: Scope = 'Global';

  table.append(
    el('thead', {
      children: [
        el('tr', {
          children: [el('th', { text: 'Rank' }), el('th', { text: 'Name' }), el('th', { text: 'Wins' })],
        }),
      ],
    }),
    tbody,
  );

  const tabs = SCOPES.map((scope) => {
    const tab = el('button', {
      className: 'tab',
      text: scope,
      attrs: { type: 'button', role: 'tab', 'aria-selected': 'false', tabindex: '-1' },
    });
    tab.addEventListener('click', () => void select(scope));
    tab.addEventListener('focus', () => void select(scope));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const index = SCOPES.indexOf(scope);
      const next = SCOPES[(index + (event.key === 'ArrowRight' ? 1 : SCOPES.length - 1)) % SCOPES.length];
      if (next) {
        void select(next);
        tabs[SCOPES.indexOf(next)]?.focus();
      }
    });
    tablist.append(tab);
    return tab;
  });

  async function select(scope: Scope): Promise<void> {
    active = scope;
    tabs.forEach((tab, index) => {
      const selected = SCOPES[index] === scope;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.setAttribute('tabindex', selected ? '0' : '-1');
    });
    await load();
  }

  async function load(): Promise<void> {
    const scope = active.toLowerCase();
    const result = await api<BoardBody>('GET', `/api/leaderboards?scope=${scope}`);
    if (!result.ok) return;
    clear(tbody);
    for (const row of result.data.rows) {
      tbody.append(
        el('tr', {
          children: [
            el('td', { text: `#${num(row.rank)}` }),
            el('td', { text: row.displayName }),
            el('td', { text: `${num(row.wins)} wins` }),
          ],
        }),
      );
    }
    emptyNotice.textContent =
      result.data.rows.length === 0
        ? active === 'Friends'
          ? CLUB_COPY.friendsEmpty
          : active === 'Club'
            ? CLUB_COPY.clubEmpty
            : ''
        : '';
    const own = result.data.own;
    ownText.textContent =
      own.rank === null ? CLUB_COPY.unranked : CLUB_COPY.ownRank(own.rank, state.me?.displayName ?? '', own.wins);
  }

  void select('Global');

  return {
    element: el('div', {
      className: 'leaderboards',
      children: [
        el('h1', { className: 'screen-heading', text: 'Leaderboards', attrs: { tabindex: '-1' } }),
        tablist,
        emptyNotice,
        table,
        ownRank,
      ],
    }),
  };
}
