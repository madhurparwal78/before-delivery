import * as pg from 'pg';
import { randomId } from './util';
import type { StorageClient } from './storage';
import type { BroadcastHub } from './hub';
import type { PocketBaseClient } from './pocketbase';
import { ApiError } from './errors';
import { freeTransfersAtDeadline, seasonHalfOf } from './rules';
import { queueNotices } from './noticeOutbox';
import { formatMillions, formatDeadline } from '../shared/format';
import { toLeagueTime } from './util';
import { GAMEWEEK_COUNT } from '../shared/domain';

export interface SnapshotContents {
  gameweek: number;
  manager_id: string;
  team_name: string;
  locked_at: string;
  starting: string[];
  bench: string[];
  captain: string | null;
  vice_captain: string | null;
  chip: string | null;
  bank_tenths: number;
  squad: { player_id: string; position: string; club: string; purchase_price_tenths: number; selling_price_tenths: number }[];
}

export function snapshotKey(gameweek: number, managerId: string): string {
  return `snapshots/gw-${String(gameweek).padStart(2, '0')}/${managerId}.json`;
}

export interface LockOutcome {
  locked: number;
  noticesQueued: number;
}

export async function lockGameweek(
  pool: pg.Pool,
  gameweek: number,
  hub: BroadcastHub,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ status: string }>(
      'SELECT status FROM gameweeks WHERE number = $1 FOR UPDATE',
      [gameweek],
    );
    if (rows[0].status !== 'open') {
      await client.query('ROLLBACK');
      return;
    }
    await client.query(
      `UPDATE gameweeks SET status = 'locked', locked_at = now() WHERE number = $1`,
      [gameweek],
    );

    const squads = await client.query<{ manager_id: string; bank_tenths: number; free_transfers: number; team_name: string; pocketbase_id: string }>(
      `SELECT sm.manager_id, sm.bank_tenths, sm.free_transfers, m.team_name, m.pocketbase_id
         FROM squad_meta sm JOIN managers m ON m.id = sm.manager_id`,
    );

    for (const squad of squads.rows) {
      const pick = await client.query<{ starting: string[]; bench: string[]; captain: string | null; vice_captain: string | null }>(
        'SELECT starting, bench, captain, vice_captain FROM picks WHERE manager_id = $1 AND gameweek = $2',
        [squad.manager_id, gameweek],
      );
      if (pick.rows.length === 0) continue;
      const chip = await client.query<{ chip: string }>(
        'SELECT chip FROM chips WHERE manager_id = $1 AND gameweek = $2 AND cancelled = false',
        [squad.manager_id, gameweek],
      );
      const squadPlayers = await client.query<{ player_id: string; purchase_price_tenths: number; position: string; club: string; price_tenths: number }>(
        `SELECT sp.player_id, sp.purchase_price_tenths, p.position, p.club, p.price_tenths
           FROM squad_players sp JOIN players p ON p.id = sp.player_id
          WHERE sp.manager_id = $1`,
        [squad.manager_id],
      );

      await client.query(
        `INSERT INTO locked_teams (manager_id, gameweek, starting, bench, captain, vice_captain, chip, bank_tenths, squad, locked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (manager_id, gameweek) DO NOTHING`,
        [
          squad.manager_id,
          gameweek,
          pick.rows[0].starting,
          pick.rows[0].bench,
          pick.rows[0].captain,
          pick.rows[0].vice_captain,
          chip.rows[0]?.chip ?? null,
          squad.bank_tenths,
          JSON.stringify(
            squadPlayers.rows.map((row) => ({
              player_id: row.player_id,
              position: row.position,
              club: row.club,
              purchase_price_tenths: row.purchase_price_tenths,
              selling_price_tenths: sellingPriceFor(row.purchase_price_tenths, row.price_tenths),
            })),
          ),
        ],
      );

      const nextFree = freeTransfersAtDeadline(squad.free_transfers);
      await client.query(
        'UPDATE squad_meta SET free_transfers = $1 WHERE manager_id = $2',
        [nextFree, squad.manager_id],
      );
      await client.query(
        `INSERT INTO hits (manager_id, gameweek, hit_points) VALUES ($1, $2, 0)
         ON CONFLICT (manager_id, gameweek) DO NOTHING`,
        [squad.manager_id, gameweek],
      );
    }

    await client.query(
      'UPDATE drafts SET state = $1, out_players = $2, in_players = $3, refusal = NULL WHERE gameweek = $4 AND state <> $1',
      ['clean', [], [], gameweek],
    );

    const notices = squads.rows
      .filter((squad) => hasPickFor(client, squad.manager_id, gameweek))
      .map((squad) => ({
        manager_id: squad.manager_id,
        pocketbase_user_id: squad.pocketbase_id,
        kind: 'deadline_locked' as const,
        gameweek,
        message: `Gameweek ${gameweek} is locked. Your team is set.`,
      }));
    await queueNotices(client, notices);

    await client.query('COMMIT');
    hub.broadcastToManagers({ gameweekStatus: await readStatus(pool, gameweek) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function hasPickFor(client: pg.PoolClient, managerId: string, gameweek: number): Promise<boolean> {
  const { rows } = await client.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM picks WHERE manager_id = $1 AND gameweek = $2',
    [managerId, gameweek],
  );
  return rows[0].count !== '0';
}

function sellingPriceFor(purchase: number, price: number): number {
  if (price <= purchase) return price;
  return purchase + Math.floor((price - purchase) / 2);
}

export async function readStatus(pool: pg.Pool, gameweek: number): Promise<{ number: number; status: string }> {
  const { rows } = await pool.query<{ number: number; status: string }>(
    'SELECT number, status FROM gameweeks WHERE number = $1',
    [gameweek],
  );
  return rows[0];
}

export async function writeSnapshotsForGameweek(
  pool: pg.Pool,
  storage: StorageClient,
  hub: BroadcastHub,
  gameweek: number,
): Promise<void> {
  const { rows } = await pool.query<{ manager_id: string; team_name: string }>(
    `SELECT lt.manager_id, m.team_name
       FROM locked_teams lt JOIN managers m ON m.id = lt.manager_id
      WHERE lt.gameweek = $1 AND lt.receipt = 'pending'`,
    [gameweek],
  );
  for (const row of rows) {
    await writeSnapshot(pool, storage, hub, gameweek, row.manager_id, row.team_name);
  }
}

export async function writeSnapshot(
  pool: pg.Pool,
  storage: StorageClient,
  hub: BroadcastHub,
  gameweek: number,
  managerId: string,
  teamName: string,
): Promise<void> {
  const { rows } = await pool.query<{
    starting: string[];
    bench: string[];
    captain: string | null;
    vice_captain: string | null;
    chip: string | null;
    bank_tenths: number;
    squad: unknown;
    locked_at: Date;
    receipt: string;
  }>(
    'SELECT starting, bench, captain, vice_captain, chip, bank_tenths, squad, locked_at, receipt FROM locked_teams WHERE manager_id = $1 AND gameweek = $2',
    [managerId, gameweek],
  );
  if (rows.length === 0) return;
  if (rows[0].receipt === 'stored') return;
  const contents: SnapshotContents = {
    gameweek,
    manager_id: managerId,
    team_name: teamName,
    locked_at: rows[0].locked_at.toISOString(),
    starting: rows[0].starting,
    bench: rows[0].bench,
    captain: rows[0].captain,
    vice_captain: rows[0].vice_captain,
    chip: rows[0].chip,
    bank_tenths: rows[0].bank_tenths,
    squad: rows[0].squad as SnapshotContents['squad'],
  };
  try {
    await storage.put(snapshotKey(gameweek, managerId), JSON.stringify(contents, null, 2));
  } catch {
    return;
  }
  await pool.query(
    "UPDATE locked_teams SET receipt = 'stored' WHERE manager_id = $1 AND gameweek = $2 AND receipt = 'pending'",
    [managerId, gameweek],
  );
  hub.broadcastToManagers({ receipt: { manager_id: managerId, gameweek, receipt: 'stored' } });
}

export async function startGameweek(pool: pg.Pool, gameweek: number, hub: BroadcastHub): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ status: string }>(
      'SELECT status FROM gameweeks WHERE number = $1 FOR UPDATE',
      [gameweek],
    );
    if (rows.length === 0 || rows[0].status !== 'locked') {
      await client.query('ROLLBACK');
      throw new ApiError(409, 'gameweek_not_locked', `Gameweek ${gameweek} is not locked.`);
    }
    await client.query(`UPDATE gameweeks SET status = 'live' WHERE number = $1`, [gameweek]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  hub.broadcastToManagers({ gameweekStatus: await readStatus(pool, gameweek) });
}

export async function openNextGameweek(pool: pg.Pool, gameweek: number): Promise<number | null> {
  const next = gameweek + 1;
  if (next > GAMEWEEK_COUNT) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE gameweeks SET status = 'open' WHERE number = $1 AND status = 'upcoming'`, [next]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return next;
}
