/** The suspension cascade: abandoned games, returned stakes, freed seats, paused runs,
 * cancelled trades. Runs in the same transaction that suspends the server. */

import type { Queryer } from "../db/pool.js";
import { publishTx } from "../api/events.js";
import { newId } from "../db/seed.js";
import { buildResult, type SeatInfo, type TableInfo } from "../tables/settle.js";

/** Called inside the transaction that moves a server to suspended. */
export async function suspendCascade(client: Queryer, serverId: string): Promise<void> {
  const games = (
    await client.query<{ id: string; table_id: string }>(
      `SELECT g.id, g.table_id FROM games g
       JOIN tables_ t ON t.id = g.table_id
       WHERE t.server_id = $1 AND g.state = 'in_progress'
       ORDER BY g.started_at`,
      [serverId]
    )
  ).rows;
  for (const game of games) {
    const seats = (await client.query<SeatInfo>("SELECT seat, character_id FROM seats WHERE table_id = $1 ORDER BY seat", [game.table_id])).rows;
    await client.query("UPDATE games SET state = 'finished', finished_at = now() WHERE id = $1", [game.id]);
    const table = (
      await client.query<TableInfo>("SELECT id, server_id, game, stake FROM tables_ WHERE id = $1 FOR UPDATE", [game.table_id])
    ).rows[0];
    if (table === undefined) continue;
    const result = await buildResult(client, table, "server_suspended", [], seats);
    await client.query(
      `INSERT INTO game_results (game_id, result, stored) VALUES ($1,$2,false)
       ON CONFLICT (game_id) DO UPDATE SET result = EXCLUDED.result`,
      [game.id, JSON.stringify(result)]
    );
    await publishTx(client, serverId, [{ kind: "announcement", payload: { text: result.text }, audience: { table: game.table_id } }]);
  }
  // All seats freed, all spectators removed, tables open.
  await client.query(`DELETE FROM spectators WHERE table_id IN (SELECT id FROM tables_ WHERE server_id = $1)`, [serverId]);
  await client.query(`DELETE FROM seats WHERE table_id IN (SELECT id FROM tables_ WHERE server_id = $1)`, [serverId]);
  await client.query(`UPDATE tables_ SET state = 'open', etag = $2 WHERE server_id = $1 AND state <> 'open'`, [serverId, newId()]);
  // Every in-progress chapter run pauses.
  await client.query("UPDATE chapter_runs SET state = 'paused' WHERE server_id = $1 AND state = 'in_progress'", [serverId]);
  // Every open trade cancels.
  await client.query("UPDATE trades SET state = 'cancelled' WHERE server_id = $1 AND state = 'open'", [serverId]);
}

/** Reactivation returns paused runs to in_progress. */
export async function reactivateRuns(client: Queryer, serverId: string): Promise<void> {
  await client.query("UPDATE chapter_runs SET state = 'in_progress' WHERE server_id = $1 AND state = 'paused'", [serverId]);
}
