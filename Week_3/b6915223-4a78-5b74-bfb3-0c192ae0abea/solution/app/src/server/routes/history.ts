import type { LedgerEntry, LedgerView, TransferRecord } from "../../shared/api.ts";
import { pool } from "../db.ts";
import { ApiError, conflict, notFound } from "../errors.ts";
import { json, route, type Reply } from "../http.ts";
import { sellingPrice } from "../rules/money.ts";
import { fetchObject, snapshotKey, StorageUnreachable } from "../storage.ts";
import { gameweekParam } from "../validate.ts";
import { historyView } from "../views.ts";

// History, the paired bank ledger and snapshot downloads (brief: History and snapshots).

export async function snapshotDownload(managerId: string, gameweek: number): Promise<Reply> {
  const found = await pool.query<{ receipt: string }>("SELECT receipt FROM locked_teams WHERE manager_id = $1 AND gameweek = $2", [
    managerId,
    gameweek,
  ]);
  const row = found.rows[0];
  if (!row) throw notFound(`There is no locked team for gameweek ${gameweek}.`);
  if (row.receipt !== "stored") throw conflict("receipt_pending", "The receipt is still pending. Try again when it shows as stored.");
  let bytes: Buffer;
  try {
    bytes = await fetchObject(snapshotKey(gameweek, managerId));
  } catch (error) {
    if (error instanceof StorageUnreachable) {
      throw new ApiError(503, "storage_unavailable", "Storage is unreachable. Try the download again in a minute.");
    }
    throw error;
  }
  const name = `elevens-gw${String(gameweek).padStart(2, "0")}-${managerId}.json`;
  return { status: 200, raw: bytes, headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${name}"` } };
}

export const historyRoutes = [
  route("GET", "/api/history", "manager", async ({ session }) => json(200, await historyView(pool, session.managerId))),

  route("GET", "/api/history/transfers", "manager", async ({ session }) => {
    const rows = await pool.query<{
      id: number;
      gameweek: number;
      made_at: Date;
      out_player_id: string;
      out_name: string;
      sell_price_tenths: number;
      in_player_id: string;
      in_name: string;
      price_tenths: number;
      free_hit: boolean;
    }>(
      `SELECT t.id, t.gameweek, t.made_at, t.out_player_id, po.name AS out_name, t.sell_price_tenths,
              t.in_player_id, pi.name AS in_name, t.price_tenths, t.free_hit
       FROM transfers t JOIN players po ON po.id = t.out_player_id JOIN players pi ON pi.id = t.in_player_id
       WHERE t.manager_id = $1 ORDER BY t.id`,
      [session.managerId],
    );
    const transfers = rows.rows.map(
      (row): TransferRecord => ({
        id: row.id,
        gameweek: row.gameweek,
        made_at: row.made_at.toISOString(),
        out: { player_id: row.out_player_id, name: row.out_name, sell_price_tenths: row.sell_price_tenths },
        in: { player_id: row.in_player_id, name: row.in_name, price_tenths: row.price_tenths },
        free_hit: row.free_hit,
      }),
    );
    return json(200, { transfers });
  }),

  route("GET", "/api/history/ledger", "manager", async ({ session }) => {
    const [entries, squad] = await Promise.all([
      pool.query<Omit<LedgerEntry, "created_at"> & { created_at: Date }>(
        "SELECT id, kind, amount_tenths, player_id, transfer_id, reverses, gameweek, created_at FROM ledger_entries WHERE manager_id = $1 ORDER BY id",
        [session.managerId],
      ),
      pool.query<{ purchase_price_tenths: number; price_tenths: number }>(
        "SELECT sp.purchase_price_tenths, p.price_tenths FROM squad_players sp JOIN players p ON p.id = sp.player_id WHERE sp.manager_id = $1",
        [session.managerId],
      ),
    ]);
    const view: LedgerView = {
      bank_tenths: entries.rows.reduce((sum, entry) => sum + entry.amount_tenths, 0),
      squad_selling_value_tenths: squad.rows.reduce((sum, row) => sum + sellingPrice(row.purchase_price_tenths, row.price_tenths), 0),
      entries: entries.rows.map((entry) => ({ ...entry, created_at: entry.created_at.toISOString() })),
    };
    return json(200, view);
  }),

  route("GET", "/api/history/:gameweek/snapshot", "manager", async ({ session, params }) =>
    snapshotDownload(session.managerId, gameweekParam(params.gameweek)),
  ),
];
