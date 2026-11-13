import type { DailyShape, LeaderboardShape } from '../../shared/api';
import { formatLongDate, isPlainDate } from '../../shared/dates';
import type { LeaderboardRow } from '../../shared/leaderboard';
import { M } from '../../shared/messages';
import { formatTime } from '../../shared/score';
import { api } from '../api';
import { announce } from '../announcer';
import { apply, clear, el, text } from '../dom';
import { LiveSocket } from '../live';
import type { Cleanup, PageContext } from '../main';
import { noticeFor } from '../main';
import { renderNotFound } from './notfound';

const COLUMNS = ['Rank', 'Player', 'Time', 'Score', 'Mistakes', 'Hints'] as const;

export async function renderLeaderboard(context: PageContext): Promise<Cleanup | void> {
  const { main } = context;
  main.append(text('h1', 'Daily leaderboard'));
  const loading = text('p', M.preparing, { class: 'serif-sentence' });
  main.append(loading);

  let date = context.params.date ?? '';
  if (date !== '' && !isPlainDate(date)) {
    loading.remove();
    renderNotFound(main, M.pageNotFound);
    return;
  }
  if (date === '') {
    try {
      date = (await api.get<DailyShape>('/api/daily')).today;
    } catch (cause) {
      loading.textContent = noticeFor(cause);
      announce(noticeFor(cause));
      return;
    }
  }

  let board: LeaderboardShape;
  try {
    board = await api.get<LeaderboardShape>(`/api/leaderboard/${date}`);
  } catch (cause) {
    loading.textContent = noticeFor(cause);
    announce(noticeFor(cause));
    return;
  }
  loading.remove();

  const body = el('tbody');
  const table = el('table', {
    'aria-label': `Daily leaderboard, ${formatLongDate(date)}`,
    class: 'rows-table',
  });
  const head = el('tr');
  for (const column of COLUMNS) head.append(el('th', { scope: 'col' }, [column]));
  table.append(el('thead', {}, [head]), body);
  const notice = el('p', { id: 'leaderboard-notice', class: 'notice' });
  main.append(el('div', { class: 'table-tile' }, [table]), notice);

  function renderRows(rows: LeaderboardRow[]): void {
    clear(body);
    for (const row of rows) {
      const line = el('tr', { 'data-player': row.display_name });
      if (context.player && row.display_name === context.player.display_name) {
        apply(line, { 'aria-current': 'true' });
      }
      const cells = [
        String(row.rank),
        row.display_name,
        formatTime(row.seconds),
        String(row.score),
        String(row.mistakes),
        String(row.hints),
      ];
      for (const value of cells) line.append(el('td', {}, [value]));
      body.append(line);
    }
    notice.textContent = noticeText(rows.length);
  }

  function noticeText(count: number): string {
    if (!board.live) return M.liveUpdatesPaused;
    if (context.player && !context.player.verified) return M.confirmEmailLeaderboard;
    if (count === 0) return M.leaderboardEmpty;
    return '';
  }

  renderRows(board.rows);
  if (!board.live) announce(M.liveUpdatesPaused);

  if (!board.live) return;

  const socket = new LiveSocket({
    onOpen: () => socket.send({ type: 'leaderboard', date }),
    onMessage: (message) => {
      if (message.type !== 'leaderboard' || message.date !== date) return;
      renderRows(message.rows);
      announce(M.leaderboardUpdate(message.latest.display_name, message.latest.rank));
    },
  });

  return () => socket.close();
}
