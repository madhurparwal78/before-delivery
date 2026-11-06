import type { PoolClient } from 'pg';
import { COPY } from '../../shared/copy.js';
import { appendEvent } from './events.js';
import {
  type GameRow,
  type TableRow,
  endWithoutMove,
  pushAnnouncement,
  publishTable,
  storeAndSettle,
} from './games.js';
import { escrowAccount, writeEntry } from './ledger.js';
import { endCopy } from './settlement.js';

/**
 * The suspension cascade, run inside the same transaction that moves a server
 * to suspended. Every game in play is abandoned with its stakes returned, seats
 * and spectators are freed, chapter runs pause and open trades are cancelled.
 */
export interface CascadeOutcome {
  readonly abandonedGameIds: readonly string[];
  readonly tableIds: readonly string[];
  readonly tradeIds: readonly string[];
}

export async function cascadeSuspension(
  client: PoolClient,
  serverId: string,
): Promise<CascadeOutcome> {
  const tables = await client.query<TableRow>(
    'SELECT * FROM game_tables WHERE server_id = $1 ORDER BY id FOR UPDATE',
    [serverId],
  );

  const abandoned: string[] = [];
  const touched: string[] = [];

  for (const table of tables.rows) {
    const watchers = await client.query('SELECT 1 FROM spectators WHERE table_id = $1 LIMIT 1', [
      table.id,
    ]);
    const hadPlayers = table.state !== 'open' || (watchers.rowCount ?? 0) > 0;

    if (table.game_id !== null && table.state === 'in_play') {
      const games = await client.query<GameRow>('SELECT * FROM games WHERE id = $1 FOR UPDATE', [
        table.game_id,
      ]);
      const game = games.rows[0];
      if (game !== undefined && game.state === 'in_play') {
        const ended = await endWithoutMove(client, table, game, 'server_suspended', null);
        if (ended.game.stake > 0) {
          await writeEntry(client, {
            serverId,
            kind: 'settlement',
            gameId: ended.game.id,
            lines: [
              {
                account: escrowAccount(ended.game.id),
                amount: -ended.game.stake * ended.game.seats.length,
              },
              ...ended.game.seats.map((seat) => ({
                account: seat.character_id,
                amount: ended.game.stake,
              })),
            ],
          });
        }
        await client.query('UPDATE games SET settled = true WHERE id = $1', [ended.game.id]);
        abandoned.push(ended.game.id);
        await appendEvent(
          {
            serverId,
            stream: 'table',
            scopeId: table.id,
            kind: 'announcement',
            payload: { text: endCopy(ended.ending) },
          },
          client,
        );
      }
    }

    await client.query('DELETE FROM seats WHERE table_id = $1', [table.id]);
    await client.query('DELETE FROM spectators WHERE table_id = $1', [table.id]);
    await client.query('DELETE FROM rematch_offers WHERE table_id = $1', [table.id]);
    await client.query(
      `UPDATE game_tables SET state = 'open', game_id = NULL, revision = revision + 1 WHERE id = $1`,
      [table.id],
    );

    if (hadPlayers) {
      await appendEvent(
        {
          serverId,
          stream: 'table',
          scopeId: table.id,
          kind: 'announcement',
          payload: { text: COPY.tableSuspended },
        },
        client,
      );
    }
    touched.push(table.id);
  }

  await client.query(
    `UPDATE chapter_runs SET state = 'paused' WHERE server_id = $1 AND state = 'in_progress'`,
    [serverId],
  );

  const trades = await client.query<{ id: string }>(
    `UPDATE trades SET state = 'cancelled', updated_at = now()
      WHERE server_id = $1 AND state = 'open' RETURNING id`,
    [serverId],
  );

  return {
    abandonedGameIds: abandoned,
    tableIds: touched,
    tradeIds: trades.rows.map((row) => row.id),
  };
}

/** Writes each abandoned game's result bundle, as for any finished game. */
export async function finishCascade(outcome: CascadeOutcome): Promise<void> {
  for (const tableId of outcome.tableIds) await publishTable(tableId);
  for (const gameId of outcome.abandonedGameIds) await storeAndSettle(gameId);
}

/** Reactivation returns paused runs to in_progress. */
export async function resumeRuns(client: PoolClient, serverId: string): Promise<void> {
  await client.query(
    `UPDATE chapter_runs SET state = 'in_progress' WHERE server_id = $1 AND state = 'paused'`,
    [serverId],
  );
}

export { pushAnnouncement };
