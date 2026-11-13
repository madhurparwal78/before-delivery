import { one, pool, query, transaction, withAdvisoryLock } from '../db.ts';
import type { ChipCode } from '../../shared/types.ts';
import { sellingPriceTenths } from '../../shared/money.ts';
import { noticeMessage } from '../../shared/copy.ts';
import { freeTransfersAfterDeadline, freeTransfersLeft } from '../domain/hits.ts';
import { TOTAL_GAMEWEEKS } from '../domain/seed.ts';
import { StorageUnavailable, putSnapshot, snapshotKey } from '../services/storage.ts';
import { broadcast, sendTo } from '../services/realtime.ts';
import { currentGameweekView } from './gameweeks.ts';
import { lineupOf, loadSquad } from './squad.ts';
import { discardDraftsAtLock } from './transfers.ts';
import { queueNotice } from './notices.ts';

interface LockCandidate {
  manager_id: string;
  team_name: string;
  bank_tenths: number;
  free_transfers_at_start: number;
  transfers_counted: number;
  chip: ChipCode | null;
}

export const lockGameweek = async (number: number): Promise<boolean> =>
  withAdvisoryLock(`lock-gameweek-${number}`, async () => {
    const locked = await transaction(async (client) => {
      const marked = await query<{ number: number }>(
        client,
        `update gameweeks set status = 'locked', locked_at = now()
          where number = $1 and status = 'open' returning number`,
        [number],
      );
      if (marked.length === 0) return false;

      const lockedAt = new Date().toISOString();
      const candidates = await query<LockCandidate>(
        client,
        `select s.manager_id, m.team_name, s.bank_tenths,
                coalesce(mg.free_transfers_at_start, 0) as free_transfers_at_start,
                coalesce(mg.transfers_counted, 0) as transfers_counted,
                cp.chip
           from squads s
           join managers m on m.id = s.manager_id
           left join manager_gameweeks mg
                  on mg.manager_id = s.manager_id and mg.gameweek = $1
           left join chips_played cp
                  on cp.manager_id = s.manager_id and cp.gameweek = $1`,
        [number],
      );

      for (const candidate of candidates) {
        // Waits for any change accepted just before the deadline, so no team is part locked.
        await client.query(
          'select 1 from squad_players where manager_id = $1 for update',
          [candidate.manager_id],
        );
        const rows = await loadSquad(client, candidate.manager_id);
        const lineup = lineupOf(rows);
        const snapshot = {
          gameweek: number,
          manager_id: candidate.manager_id,
          team_name: candidate.team_name,
          locked_at: lockedAt,
          starting: lineup.starting,
          bench: lineup.bench,
          captain: lineup.captain,
          vice_captain: lineup.vice_captain,
          chip: candidate.chip,
          bank_tenths: candidate.bank_tenths,
          squad: rows.map((entry) => ({
            player_id: entry.player_id,
            position: entry.position,
            club: entry.club,
            purchase_price_tenths: entry.purchase_price_tenths,
            selling_price_tenths: sellingPriceTenths(
              entry.purchase_price_tenths,
              entry.price_tenths,
            ),
          })),
        };

        await client.query(
          `insert into locked_teams
             (manager_id, gameweek, starting, bench, captain, vice_captain, chip,
              bank_tenths, locked_at, snapshot_json)
           values ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9, $10)
           on conflict (manager_id, gameweek) do nothing`,
          [
            candidate.manager_id,
            number,
            JSON.stringify(lineup.starting),
            JSON.stringify(lineup.bench),
            lineup.captain,
            lineup.vice_captain,
            candidate.chip,
            candidate.bank_tenths,
            lockedAt,
            JSON.stringify(snapshot),
          ],
        );

        if (number < TOTAL_GAMEWEEKS) {
          const remaining = freeTransfersLeft(
            candidate.free_transfers_at_start,
            candidate.transfers_counted,
          );
          await client.query(
            `insert into manager_gameweeks (manager_id, gameweek, free_transfers_at_start)
             values ($1, $2, $3)
             on conflict (manager_id, gameweek) do nothing`,
            [candidate.manager_id, number + 1, freeTransfersAfterDeadline(remaining)],
          );
        }

        await queueNotice(client, {
          managerId: candidate.manager_id,
          kind: 'deadline_locked',
          gameweek: number,
          message: noticeMessage.deadlineLocked(number),
          dedupeKey: `deadline_locked:${number}:${candidate.manager_id}`,
        });
      }

      await discardDraftsAtLock(client, number);
      return true;
    });

    if (!locked) return false;
    broadcast({ type: 'gameweek', gameweek: await currentGameweekView() });
    broadcast({ type: 'squad' });
    void flushSnapshots();
    return true;
  });

interface PendingSnapshot {
  manager_id: string;
  gameweek: number;
  snapshot_json: string;
}

export const flushSnapshots = async (): Promise<void> => {
  const pending = await query<PendingSnapshot>(
    pool,
    `select manager_id, gameweek, snapshot_json from locked_teams
      where receipt = 'pending' order by gameweek, manager_id limit 200`,
  );
  for (const snapshot of pending) {
    const key = snapshotKey(snapshot.gameweek, snapshot.manager_id);
    try {
      await withAdvisoryLock(`snapshot-${key}`, async () => {
        const still = await one<{ receipt: string }>(
          pool,
          'select receipt from locked_teams where manager_id = $1 and gameweek = $2',
          [snapshot.manager_id, snapshot.gameweek],
        );
        if (still?.receipt !== 'pending') return;
        await putSnapshot(key, Buffer.from(snapshot.snapshot_json, 'utf8'));
        await query(
          pool,
          `update locked_teams set receipt = 'stored'
            where manager_id = $1 and gameweek = $2 and receipt = 'pending'`,
          [snapshot.manager_id, snapshot.gameweek],
        );
      });
      sendTo(snapshot.manager_id, { type: 'squad' });
    } catch (error) {
      if (error instanceof StorageUnavailable) return;
      throw error;
    }
  }
};
