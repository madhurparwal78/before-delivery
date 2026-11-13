import { query, transaction } from './db.js';
import { forbidden, notFound } from './errors.js';
import { env } from './env.js';
import { bus } from './bus.js';
import { createMatch } from './match.js';
import { equippedFor } from './players.js';
import type { PlayerRow } from './players.js';
import { bandFor } from '../shared/queue.js';

export type QueueMode = 'casual' | 'ranked';

function band(near: number, waitedSeconds: number) {
  return bandFor(near, waitedSeconds, env.bandWidenSeconds);
}

interface EntryRow {
  player_id: string;
  mode: QueueMode;
  near: number;
  entered_at: Date;
  match_id: string | null;
  name: string;
  avatar: number;
}

export async function enterQueue(player: PlayerRow, mode: QueueMode): Promise<Record<string, unknown>> {
  if (mode === 'ranked' && player.email === null) throw forbidden('LINK_REQUIRED');
  const near = Math.round(player.rating);
  await query(
    `insert into queue_entries (player_id, mode, near, entered_at, match_id)
     values ($1, $2, $3, now(), null)
     on conflict (player_id) do update set mode = $2, near = $3, entered_at = now(), match_id = null`,
    [player.id, mode, near],
  );
  void pairOnce();
  return { mode, near, band: mode === 'ranked' ? band(near, 0) : null };
}

export async function queueStatus(player: PlayerRow): Promise<Record<string, unknown>> {
  const rows = await query<EntryRow>(
    `select q.player_id, q.mode, q.near, q.entered_at, q.match_id::text, p.name, p.avatar
     from queue_entries q join players p on p.id = q.player_id where q.player_id = $1`,
    [player.id],
  );
  const entry = rows[0];
  if (entry === undefined) throw notFound();
  const waitedSeconds = Math.floor((Date.now() - entry.entered_at.getTime()) / 1000);
  return {
    mode: entry.mode,
    near: entry.near,
    band: entry.mode === 'ranked' ? band(entry.near, waitedSeconds) : null,
    waitedSeconds,
    matchId: entry.match_id,
  };
}

export async function leaveQueue(player: PlayerRow): Promise<void> {
  await query('delete from queue_entries where player_id = $1 and match_id is null', [player.id]);
}

function pushStatus(entry: EntryRow, now: number): void {
  const waitedSeconds = Math.floor((now - entry.entered_at.getTime()) / 1000);
  bus.toPlayer(entry.player_id, 'queueStatus', {
    mode: entry.mode,
    near: entry.near,
    band: entry.mode === 'ranked' ? band(entry.near, waitedSeconds) : null,
    waitedSeconds,
    matchId: entry.match_id,
  });
}

let pairing = false;

/** One atomic pairing pass: every waiting player is paired exactly once. */
export async function pairOnce(): Promise<void> {
  if (pairing) return;
  pairing = true;
  try {
    const waiting = await query<EntryRow>(
      `select q.player_id, q.mode, q.near, q.entered_at, q.match_id::text, p.name, p.avatar
       from queue_entries q join players p on p.id = q.player_id
       where q.match_id is null
       order by q.entered_at asc, q.player_id asc`,
    );
    const now = Date.now();
    const taken = new Set<string>();
    for (const first of waiting) {
      if (taken.has(first.player_id)) continue;
      const firstWaited = Math.floor((now - first.entered_at.getTime()) / 1000);
      const firstBand = band(first.near, firstWaited);
      for (const second of waiting) {
        if (second.player_id === first.player_id) continue;
        if (taken.has(second.player_id)) continue;
        if (second.mode !== first.mode) continue;
        if (first.mode === 'ranked') {
          const secondWaited = Math.floor((now - second.entered_at.getTime()) / 1000);
          const secondBand = band(second.near, secondWaited);
          const withinFirst = second.near >= firstBand.low && second.near <= firstBand.high;
          const withinSecond = first.near >= secondBand.low && first.near <= secondBand.high;
          if (!withinFirst || !withinSecond) continue;
        }
        taken.add(first.player_id);
        taken.add(second.player_id);
        await pair(first, second);
        break;
      }
    }
    for (const entry of waiting) {
      if (taken.has(entry.player_id)) continue;
      pushStatus(entry, now);
    }
  } finally {
    pairing = false;
  }
}

async function pair(first: EntryRow, second: EntryRow): Promise<void> {
  const match = await createMatch({
    mode: first.mode,
    format: 'classic',
    seats: [
      {
        playerId: first.player_id,
        name: first.name,
        avatar: first.avatar,
        strikerSkin: (await equippedFor(first.player_id)).striker,
      },
      {
        playerId: second.player_id,
        name: second.name,
        avatar: second.avatar,
        strikerSkin: (await equippedFor(second.player_id)).striker,
      },
    ],
    startActive: true,
  });
  const claimed = await transaction(async (client) => {
    const result = await client.query(
      'update queue_entries set match_id = $1 where player_id = any($2) and match_id is null',
      [match.id, [first.player_id, second.player_id]],
    );
    return result.rowCount === 2;
  });
  if (!claimed) return;
  for (const entry of [first, second]) {
    bus.toPlayer(entry.player_id, 'matchFound', { matchId: match.id });
  }
}

export function startQueueLoop(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void pairOnce().catch(() => undefined);
  }, 250);
  timer.unref();
  return timer;
}
