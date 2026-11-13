import type { Op, SolveRecord } from '../../shared/types';
import { RECORD_RETRY_MS } from '../config';
import { query } from '../db';
import { recordKey, storage } from '../storage';
import { finalSquares, initialSquares } from './service';
import {
  elapsedMs,
  loadGameState,
  playerStats,
  revealedCount,
  type GameState,
} from './state';

const inFlight = new Set<string>();

export async function loadOps(gameId: string): Promise<Op[]> {
  const result = await query<{ op: Op }>(
    'select op from ops where game_id = $1 order by seq',
    [gameId],
  );
  return result.rows.map((row) => row.op);
}

async function buildRecord(state: GameState): Promise<SolveRecord> {
  const ops = await loadOps(state.game.id);
  const stats = playerStats(state);
  return {
    format: 'overlap-solve-record-1',
    game_id: state.game.id,
    puzzle_id: state.game.puzzle_id,
    puzzle_title: state.puzzle.title,
    cols: state.puzzle.cols,
    rows: state.puzzle.rows,
    solved_at: (state.game.solved_at as Date).toISOString(),
    elapsed_ms: elapsedMs(state),
    revealed_count: revealedCount(state),
    checked_count: state.game.checked_count,
    players: state.seats.map((seat) => ({
      id: seat.player_id,
      display_name: seat.display_name,
      colour: seat.colour,
    })),
    initial: initialSquares(state),
    final: finalSquares(state),
    ops,
    timer_segments: state.segments
      .filter((segment) => segment.ended_at !== null)
      .map((segment) => ({
        started_at: segment.started_at.toISOString(),
        ended_at: (segment.ended_at as Date).toISOString(),
      })),
    stats: state.seats.map((seat, index) => ({
      player_id: seat.player_id,
      letters: stats[index].letters,
      revealed: stats[index].revealed,
    })),
  };
}

/** One solve record per solved game, written once; a storage outage defers it. */
export async function writeSolveRecord(gameId: string): Promise<void> {
  if (inFlight.has(gameId)) return;
  inFlight.add(gameId);
  try {
    const state = await loadGameState(gameId);
    if (!state || state.game.status !== 'solved' || state.game.record_ready) return;
    if (state.game.mode === 'race') return;
    const record = await buildRecord(state);
    const bytes = new TextEncoder().encode(JSON.stringify(record));
    await storage.put(recordKey(gameId), bytes, 'application/json');
    await query('update games set record_ready = true where id = $1', [gameId]);
  } catch {
    // Storage is unreachable; the retry loop writes the record when it returns.
  } finally {
    inFlight.delete(gameId);
  }
}

export async function retryPendingRecords(): Promise<void> {
  const pending = await query<{ id: string }>(
    `select id from games where status = 'solved' and record_ready = false and mode = 'shared'`,
  );
  for (const row of pending.rows) await writeSolveRecord(row.id);
}

export function startRecordRetries(): void {
  setInterval(() => {
    void retryPendingRecords();
  }, RECORD_RETRY_MS).unref();
}
