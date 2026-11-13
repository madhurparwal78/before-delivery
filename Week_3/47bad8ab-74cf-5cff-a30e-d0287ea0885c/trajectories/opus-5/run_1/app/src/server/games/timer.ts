import type { PoolClient } from 'pg';
import { query } from '../db';
import type { GameState } from './state';

type Querier = Pick<PoolClient, 'query'>;

async function run(client: Querier | null, text: string, values: unknown[]): Promise<void> {
  if (client) await client.query(text, values);
  else await query(text, values);
}

/** The timer runs exactly while the game is live, as one open segment. */
export async function startSegment(
  client: Querier | null,
  gameId: string,
  at: Date = new Date(),
): Promise<void> {
  await run(
    client,
    `insert into timer_segments (game_id, idx, started_at)
       select $1, coalesce(max(idx) + 1, 0), $2 from timer_segments where game_id = $1`,
    [gameId, at],
  );
}

export async function closeOpenSegment(
  client: Querier | null,
  state: GameState,
  at: Date,
): Promise<void> {
  const open = state.segments.find((segment) => segment.ended_at === null);
  if (!open) return;
  await run(
    client,
    'update timer_segments set ended_at = $3 where game_id = $1 and idx = $2',
    [state.game.id, open.idx, at],
  );
  open.ended_at = at;
}
