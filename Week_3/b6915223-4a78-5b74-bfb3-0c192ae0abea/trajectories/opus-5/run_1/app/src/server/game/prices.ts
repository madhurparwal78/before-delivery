import { pool, query, transaction, withAdvisoryLock } from '../db.ts';
import type { PriceRunResult } from '../../shared/types.ts';
import { formatMillions } from '../../shared/money.ts';
import { noticeMessage } from '../../shared/copy.ts';
import { sendTo } from '../services/realtime.ts';
import { currentGameweek, effectiveStatus } from './gameweeks.ts';
import { queueNotice } from './notices.ts';
import { conflict, validation } from '../http/errors.ts';

export const GAMEWEEK_PRICE_MOVE_CAP = 3;

export interface PriceMove {
  player_id: string;
  delta_tenths: 1 | -1;
}

export const parsePriceRun = (
  body: Record<string, unknown>,
): { runDate: string; moves: PriceMove[] } => {
  const fields: Record<string, string> = {};
  const runDate = typeof body.run_date === 'string' ? body.run_date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) fields.run_date = 'Use a date as YYYY-MM-DD.';

  const raw = Array.isArray(body.moves) ? body.moves : null;
  const moves: PriceMove[] = [];
  if (raw === null || raw.length < 1 || raw.length > 200) {
    fields.moves = 'Send 1 to 200 moves.';
  } else {
    for (const entry of raw) {
      const move = entry as { player_id?: unknown; delta_tenths?: unknown };
      if (
        typeof move.player_id !== 'string' ||
        (move.delta_tenths !== 1 && move.delta_tenths !== -1)
      ) {
        fields.moves = 'Each move needs a player id and a one-tenth rise or fall.';
        break;
      }
      moves.push({ player_id: move.player_id, delta_tenths: move.delta_tenths });
    }
    if (new Set(moves.map((move) => move.player_id)).size !== moves.length) {
      fields.moves = 'Each player may move once in a run.';
    }
  }
  if (Object.keys(fields).length > 0) throw validation(fields);
  return { runDate, moves };
};

export const runPriceChange = async (
  runDate: string,
  moves: PriceMove[],
): Promise<PriceRunResult> => {
  const known = await query<{ id: string }>(pool, 'select id from players where id = any($1)', [
    moves.map((move) => move.player_id),
  ]);
  if (known.length !== moves.length) {
    throw validation({ moves: 'Every move needs a known player id.' });
  }

  const result = await withAdvisoryLock(`price-run-${runDate}`, async () => {
    const used = await query<{ run_date: string }>(
      pool,
      'select run_date from price_runs where run_date = $1',
      [runDate],
    );
    if (used.length > 0) {
      throw conflict('run_date_used', `A price change already ran for ${runDate}.`);
    }
    const gameweek = await currentGameweek();
    const status = effectiveStatus(gameweek, new Date());
    if (status === 'locked' || status === 'live') {
      throw conflict('prices_frozen', 'Prices are frozen until the gameweek closes.');
    }

    return transaction(async (client) => {
      await client.query('insert into price_runs (run_date) values ($1)', [runDate]);
      const applied: PriceRunResult['applied'] = [];
      const skipped: PriceRunResult['skipped'] = [];
      const touched = new Set<string>();

      for (const move of moves) {
        const moved = await query<{ count: string }>(
          client,
          `select count(*)::text as count from price_moves
            where player_id = $1 and gameweek = $2`,
          [move.player_id, gameweek.number],
        );
        if (Number(moved[0]!.count) >= GAMEWEEK_PRICE_MOVE_CAP) {
          skipped.push({ player_id: move.player_id, reason: 'gameweek_cap' });
          continue;
        }
        const updated = await query<{ price_tenths: number; name: string }>(
          client,
          `update players set price_tenths = price_tenths + $2
            where id = $1 returning price_tenths, name`,
          [move.player_id, move.delta_tenths],
        );
        const price = updated[0]!;
        await client.query(
          `insert into price_moves (run_date, player_id, delta_tenths, gameweek, price_tenths)
           values ($1, $2, $3, $4, $5)`,
          [runDate, move.player_id, move.delta_tenths, gameweek.number, price.price_tenths],
        );
        applied.push({
          player_id: move.player_id,
          delta_tenths: move.delta_tenths,
          price_tenths: price.price_tenths,
        });

        const owners = await query<{ manager_id: string }>(
          client,
          'select manager_id from squad_players where player_id = $1',
          [move.player_id],
        );
        for (const owner of owners) {
          touched.add(owner.manager_id);
          await queueNotice(client, {
            managerId: owner.manager_id,
            kind: 'price_change',
            gameweek: gameweek.number,
            message: noticeMessage.priceChange(
              price.name,
              move.delta_tenths > 0,
              formatMillions(price.price_tenths),
            ),
            dedupeKey: `price_change:${runDate}:${move.player_id}:${owner.manager_id}`,
          });
        }
      }
      return { run_date: runDate, applied, skipped, touched: [...touched] };
    });
  });

  for (const managerId of result.touched) sendTo(managerId, { type: 'squad' });
  return { run_date: result.run_date, applied: result.applied, skipped: result.skipped };
};
