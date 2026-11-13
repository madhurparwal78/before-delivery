import type { HistoryEntry } from '../../shared/types';
import { query } from '../db';
import { errors } from '../errors';
import { retryPendingRecords, writeSolveRecord } from '../games/records';
import {
  elapsedMs,
  loadGameState,
  playerStats,
  revealedCount,
  squareKey,
  whiteSquares,
} from '../games/state';
import { requirePlayer, sendJson } from '../http';
import { recordKey, storage } from '../storage';
import type { RouteContext } from './context';

export async function getHistory({ req, res }: RouteContext): Promise<void> {
  const player = await requirePlayer(req);
  const rows = await query<{ game_id: string }>(
    `select he.game_id from history_entries he
       join games g on g.id = he.game_id
      where he.player_id = $1
      order by g.solved_at desc`,
    [player.id],
  );
  const entries: HistoryEntry[] = [];
  for (const row of rows.rows) {
    const state = await loadGameState(row.game_id);
    if (!state || !state.game.solved_at) continue;
    entries.push({
      game_id: state.game.id,
      puzzle_id: state.game.puzzle_id,
      puzzle_title: state.puzzle.title,
      cols: state.puzzle.cols,
      rows: state.puzzle.rows,
      elapsed_ms: elapsedMs(state),
      solved_at: state.game.solved_at.toISOString(),
      revealed_count: revealedCount(state),
      checked_count: state.game.checked_count,
      record_ready: state.game.record_ready,
      players: state.seats.map((seat) => ({
        display_name: seat.display_name,
        colour: seat.colour,
      })),
      squares: whiteSquares(state.puzzle).map(({ row, col }) => ({
        row,
        col,
        owner: state.squares.get(squareKey(0, row, col))?.owner ?? null,
      })),
      stats: playerStats(state),
    });
  }
  sendJson(res, 200, { entries });
}

export async function getRecord({ req, res, params }: RouteContext): Promise<void> {
  const player = await requirePlayer(req);
  const entry = await query(
    'select 1 from history_entries where game_id = $1 and player_id = $2',
    [params[0], player.id],
  );
  if (entry.rowCount === 0) throw errors.notFound();
  const state = await loadGameState(params[0]);
  if (!state) throw errors.notFound();
  if (!state.game.record_ready) await writeSolveRecord(state.game.id);
  const bytes = await storage.get(recordKey(state.game.id));
  if (!bytes) throw errors.storageUnavailable();
  void retryPendingRecords();
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': bytes.byteLength,
    'content-disposition': `attachment; filename="${state.game.id}.json"`,
  });
  res.end(Buffer.from(bytes));
}
