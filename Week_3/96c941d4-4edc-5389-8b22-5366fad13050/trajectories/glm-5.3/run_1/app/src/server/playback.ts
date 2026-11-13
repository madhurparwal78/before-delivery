import { Client } from 'pg';
import { withTransaction } from './db.js';

export interface PlaybackRow {
  result_id: string;
  version: number;
  tick: number;
  playing: boolean;
}

export interface PlaybackUpdateOutcome {
  kind: 'ok' | 'conflict' | 'invalid' | 'not-found';
  playback?: PlaybackRow;
}

/**
 * Atomically compares expectedVersion: one concurrent writer wins and
 * increments version once; others receive the version conflict.
 */
export async function updatePlayback(resultId: string, expectedVersion: number, tick: number, playing: boolean): Promise<PlaybackUpdateOutcome> {
  return withTransaction(async (client) => {
    const result = await client.query('SELECT * FROM playback WHERE result_id = $1 FOR UPDATE', [resultId]);
    const row = result.rows[0] as PlaybackRow | undefined;
    if (!row) return { kind: 'not-found' };
    if (row.version !== expectedVersion) return { kind: 'conflict', playback: row };
    // Tick may stay, advance or restart at zero; other backward changes are invalid.
    if (tick > row.tick && tick !== 0) {
      // forward move is allowed; restart at zero is allowed too
    }
    if (tick < row.tick && tick !== 0) return { kind: 'invalid' };
    const updated = await client.query(
      'UPDATE playback SET version = version + 1, tick = $2, playing = $3, updated_at = now() WHERE result_id = $1 RETURNING *',
      [resultId, tick, playing],
    );
    return { kind: 'ok', playback: updated.rows[0] as PlaybackRow };
  });
}

export async function loadPlayback(client: Client, resultId: string): Promise<PlaybackRow | null> {
  const result = await client.query('SELECT * FROM playback WHERE result_id = $1', [resultId]);
  return (result.rows[0] as PlaybackRow) ?? null;
}

/** Initializes the single presentation record when a replay becomes eligible. */
export async function ensurePlayback(resultId: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      'INSERT INTO playback (result_id, version, tick, playing) VALUES ($1, 0, 0, false) ON CONFLICT (result_id) DO NOTHING',
      [resultId],
    );
  });
}
