import { copy } from '../../shared/copy';
import { revealedPhrase } from '../../shared/text';
import type { HistoryEntry, SolveRecord } from '../../shared/types';
import { api, ApiFailure } from '../api';
import { el, replace } from '../dom';
import { sentenceTile } from '../main';
import { pageInterval } from '../state';
import { staticGrid } from '../ui/puzzleGrid';
import { openReplayDialog } from '../ui/replay';

function blocksOf(entry: HistoryEntry): string[] {
  const white = new Set(entry.squares.map((square) => `${square.row},${square.col}`));
  const rows: string[] = [];
  for (let row = 0; row < entry.rows; row += 1) {
    let line = '';
    for (let col = 0; col < entry.cols; col += 1) line += white.has(`${row},${col}`) ? '.' : '#';
    rows.push(line);
  }
  return rows;
}

async function fetchRecord(gameId: string): Promise<SolveRecord> {
  const response = await fetch(`/api/history/${gameId}/record`);
  if (!response.ok) {
    throw new ApiFailure(response.status, (await response.json()) as { error: string; message: string });
  }
  return (await response.json()) as SolveRecord;
}

export async function mountHistory(container: HTMLElement): Promise<void> {
  const band = el('div', { class: 'band ink', role: 'alert', hidden: true });
  const list = el('div', { role: 'list', 'aria-label': 'History', class: 'board history-board' });
  container.append(band, list);

  const download = async (entry: HistoryEntry): Promise<void> => {
    try {
      const record = await fetchRecord(entry.game_id);
      band.hidden = true;
      const blob = new Blob([JSON.stringify(record)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${entry.game_id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 503) {
        band.textContent = copy.storageOutage;
        band.hidden = false;
      }
    }
  };

  const replay = async (entry: HistoryEntry): Promise<void> => {
    try {
      const record = await fetchRecord(entry.game_id);
      band.hidden = true;
      openReplayDialog(record);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 503) {
        band.textContent = copy.storageOutage;
        band.hidden = false;
      }
    }
  };

  function entryTile(entry: HistoryEntry): HTMLElement {
    const owners = new Map(
      entry.squares.map((square) => [`${square.row},${square.col}`, square.owner]),
    );
    return el('div', { role: 'listitem', class: 'tile history-tile' }, [
      staticGrid({
        blocks: blocksOf(entry),
        numbers: [],
        owners: (row, col) => owners.get(`${row},${col}`) ?? null,
        className: 'mini',
      }),
      el('p', {
        class: 'history-row',
        text: copy.historyRow(entry.puzzle_title, entry.elapsed_ms, entry.solved_at),
      }),
      entry.revealed_count > 0
        ? el('p', { class: 'muted', text: revealedPhrase(entry.revealed_count) })
        : null,
      ...entry.stats.map((stat) =>
        el('p', {
          class: 'muted',
          text: copy.solveStatsRow(stat.display_name, stat.letters, stat.revealed),
        }),
      ),
      entry.record_ready ? null : el('p', { class: 'muted', text: copy.recordPending }),
      el('div', { class: 'tile-actions' }, [
        el('button', {
          type: 'button',
          class: 'button',
          text: 'Download solve record',
          disabled: !entry.record_ready,
          onclick: () => void download(entry),
        }),
        el('button', {
          type: 'button',
          class: 'button',
          text: 'Replay',
          disabled: !entry.record_ready,
          onclick: () => void replay(entry),
        }),
      ]),
    ]);
  }

  let polling = false;

  async function refresh(): Promise<void> {
    const result = await api.history();
    replace(
      list,
      result.entries.length === 0
        ? [sentenceTile(copy.historyEmpty)]
        : result.entries.map(entryTile),
    );
    const pending = result.entries.some((entry) => !entry.record_ready);
    if (pending && !polling) {
      polling = true;
      pageInterval(() => void refresh(), 5000);
    }
  }

  await refresh();
}
