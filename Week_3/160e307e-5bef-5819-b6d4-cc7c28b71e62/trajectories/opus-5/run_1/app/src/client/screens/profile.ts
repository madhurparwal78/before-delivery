import { api } from '../api.js';
import type { HistoryRow } from '../api.js';
import { FORMAT_WORDS, MODE_WORDS } from '../copy.js';
import { clear, el } from '../dom.js';
import { refreshMe } from '../store.js';
import { avatarSvg } from '../avatars.js';
import { signedDelta } from '../../shared/rating.js';
import { emptyState, topbar } from './shell.js';

interface PlayerSummary {
  id: string;
  name: string;
  avatar: number;
  rating: number;
  rd: number;
  tier: string;
  rankedGames: number;
}

function historyRow(row: HistoryRow): HTMLElement {
  const parts: (Node | string)[] = [
    el('span', { class: 'history-row__result', text: row.result === 'won' ? 'WON' : 'LOST' }),
    el('span', { text: MODE_WORDS[row.mode] ?? row.mode }),
    el('span', { text: FORMAT_WORDS[row.format] ?? row.format }),
    el('span', { text: `vs ${row.opponent}` }),
    el('span', { class: 'num', text: `${row.yourScore}-${row.theirScore}` }),
  ];
  if (row.ratingDelta !== null) {
    parts.push(el('span', { class: 'num', text: signedDelta(row.ratingDelta) }));
  }
  return el('li', { class: 'history-row' }, parts);
}

export async function renderProfile(params: Record<string, string>, view: HTMLElement): Promise<void> {
  await refreshMe();
  let player: PlayerSummary;
  try {
    player = await api.get<PlayerSummary>(`/api/players/by-name/${encodeURIComponent(params.name)}`);
  } catch {
    clear(view);
    view.append(
      el('div', {}, [
        topbar(),
        el('section', { class: 'field field--ground' }, [
          el('h1', { class: 'display', text: 'Player not found', style: 'font-size: var(--step-3)' }),
          el('p', {}, [el('a', { href: '/', text: 'Home' })]),
        ]),
      ]),
    );
    return;
  }

  let rows: HistoryRow[] = [];
  try {
    const history = await api.get<{ matches: HistoryRow[] }>(`/api/players/${player.id}/history`);
    rows = history.matches;
  } catch {
    rows = [];
  }

  const avatar = el('span', { style: 'display:block;width:72px;height:72px;border:2px solid var(--ink)' }, [
    avatarSvg(player.avatar),
  ]);

  clear(view);
  view.append(
    el('div', {}, [
      topbar(),
      el('section', { class: 'field field--ground' }, [
        avatar,
        el('h1', { class: 'display', text: player.name, style: 'font-size: var(--step-4);margin-top:0.75rem' }),
        el('p', { id: 'rating', class: 'num', text: `${player.rating.toFixed(2)} ${player.tier}` }),
        rows.length === 0
          ? emptyState('NO MATCHES YET', { href: '/', label: 'Play your first match' })
          : el('ul', { class: 'rows', role: 'list', 'aria-label': 'Match history' }, rows.map(historyRow)),
      ]),
    ]),
  );
}
