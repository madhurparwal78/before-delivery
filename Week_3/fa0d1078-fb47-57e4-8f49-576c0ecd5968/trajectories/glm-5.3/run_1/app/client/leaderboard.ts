import { el, announce } from './dom.js';
import { api } from './api.js';
import { session } from './session.js';
import type { LeaderboardRow } from '../shared/api.js';
import { formatClock } from '../shared/score.js';
import { longDate } from '../shared/daily.js';
import * as M from '../shared/messages.js';

// The Leaderboard page: one table of flat rows. The columns are Rank, Player,
// Time, Score, Mistakes and Hints. The viewer's own row is aria-current.
// Live updates arrive over the one WebSocket and are announced.

export async function renderLeaderboardPage(date: string | null): Promise<HTMLElement> {
  const h1 = el('h1', {}, ['Daily leaderboard']);
  const page = el('div', { class: 'leaderboard-wrap' });

  let target = date;
  if (!target) {
    try {
      const daily = await api.get<{ today: string }>('/api/daily');
      target = daily.today;
    } catch {
      target = new Date().toISOString().slice(0, 10);
    }
  }
  const shown = target;

  const notice = el('p', { id: 'leaderboard-notice', class: 'form-result', role: 'status' }, []);
  const tableTile = el('div', { class: 'tile table-tile' });
  const table = el('table', { 'aria-label': `Daily leaderboard, ${longDate(shown)}` });

  function renderRows(rows: LeaderboardRow[], live: boolean): void {
    table.replaceChildren();
    const thead = el('thead');
    const headRow = el('tr');
    for (const name of ['Rank', 'Player', 'Time', 'Score', 'Mistakes', 'Hints']) {
      headRow.append(el('th', { scope: 'col' }, [name]));
    }
    thead.append(headRow);
    table.append(thead);

    const tbody = el('tbody');
    for (const row of rows) {
      const tr = el('tr', { 'data-player': row.display_name });
      if (session.player && row.display_name === session.player.display_name) {
        tr.setAttribute('aria-current', 'true');
      }
      tr.append(
        el('td', {}, [String(row.rank)]),
        el('td', {}, [row.display_name]),
        el('td', {}, [formatClock(row.seconds * 1000)]),
        el('td', {}, [String(row.score)]),
        el('td', {}, [String(row.mistakes)]),
        el('td', {}, [String(row.hints)]),
      );
      tbody.append(tr);
    }
    table.append(tbody);
    tableTile.replaceChildren(table);

    if (rows.length === 0) {
      notice.textContent = M.m48();
    } else if (!live) {
      notice.textContent = M.m47();
    } else if (session.player && !session.player.verified) {
      notice.textContent = M.m45();
    } else {
      notice.textContent = '';
    }
  }

  const res = await api.get<{ date: string; live: boolean; rows: LeaderboardRow[] }>(`/api/leaderboard/${shown}`);
  renderRows(res.rows, res.live);

  // Live updates: an open leaderboard page shows a newly verified result
  // within 2 seconds without a reload and announces M43.
  if (res.live) {
    const socket = new WebSocket(`${wsOrigin()}/ws`);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'leaderboard', date: shown }));
    });
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse((event as MessageEvent).data) as {
          type: string;
          date?: string;
          rows?: LeaderboardRow[];
          latest?: { display_name: string; rank: number };
        };
        if (message.type === 'leaderboard' && message.rows && message.date === shown) {
          renderRows(message.rows, true);
          if (message.latest) {
            announce(M.m43(message.latest.display_name, message.latest.rank));
          }
        }
      } catch {
        // ignore malformed messages
      }
    });
    socket.addEventListener('error', () => {
      notice.textContent = M.m47();
    });
  }

  page.append(h1, notice, tableTile);
  return page;
}

function wsOrigin(): string {
  return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
}
