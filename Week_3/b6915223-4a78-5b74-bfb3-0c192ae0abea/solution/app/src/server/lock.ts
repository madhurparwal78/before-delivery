import type { ChipCode, GameweekStatus, Position } from "../shared/api.ts";
import { pool, publish, tx } from "./db.ts";
import { noticeText } from "./notices.ts";
import { canStep, deadlinePassed } from "./rules/gameweek.ts";
import { freeTransfersAtDeadline } from "./rules/hits.ts";
import { sellingPrice } from "./rules/money.ts";

// The deadline lock (brief: Deadline and lock): within a second of the deadline, every team locks in one step.

interface SquadRow {
  manager_id: string;
  team_name: string;
  captain: string;
  vice_captain: string;
  free_transfers: number;
  chip: ChipCode | null;
  transfers_made: number;
  hit_points: number;
  bank: number;
  players: { player_id: string; position: Position; club: string; purchase_price_tenths: number; price_tenths: number; eleven_index: number | null; bench_order: number | null }[];
}

async function lockGameweek(number: number): Promise<boolean> {
  return tx(async (db) => {
    const now = new Date();
    const gameweek = await db.query<{ status: GameweekStatus; deadline: Date | null }>("SELECT status, deadline FROM gameweeks WHERE number = $1 FOR UPDATE", [number]);
    const row = gameweek.rows[0]!;
    if (!canStep(row.status, "lock") || !deadlinePassed(row.deadline, now)) return false;
    const squads = await db.query<SquadRow>(
      `SELECT s.manager_id, m.team_name, s.captain, s.vice_captain, s.free_transfers,
              mg.chip, COALESCE(mg.transfers_made, 0) AS transfers_made, COALESCE(mg.hit_points, 0) AS hit_points,
              (SELECT COALESCE(SUM(amount_tenths), 0)::int FROM ledger_entries le WHERE le.manager_id = s.manager_id) AS bank,
              (SELECT json_agg(json_build_object('player_id', sp.player_id, 'position', p.position, 'club', p.club,
                 'purchase_price_tenths', sp.purchase_price_tenths, 'price_tenths', p.price_tenths,
                 'eleven_index', sp.eleven_index, 'bench_order', sp.bench_order)
                 ORDER BY COALESCE(sp.eleven_index, 100 + sp.bench_order))
               FROM squad_players sp JOIN players p ON p.id = sp.player_id WHERE sp.manager_id = s.manager_id) AS players
       FROM squads s JOIN managers m ON m.id = s.manager_id
       LEFT JOIN manager_gameweeks mg ON mg.manager_id = s.manager_id AND mg.gameweek = $1`,
      [number],
    );
    const lockedAt = now.toISOString();
    const teams = squads.rows.map((squad) => {
      const starting = squad.players.filter((p) => p.eleven_index !== null).sort((a, b) => a.eleven_index! - b.eleven_index!).map((p) => p.player_id);
      const bench = squad.players.filter((p) => p.bench_order !== null).sort((a, b) => a.bench_order! - b.bench_order!).map((p) => p.player_id);
      const snapshot = {
        gameweek: number,
        manager_id: squad.manager_id,
        team_name: squad.team_name,
        locked_at: lockedAt,
        starting,
        bench,
        captain: squad.captain,
        vice_captain: squad.vice_captain,
        chip: squad.chip,
        bank_tenths: squad.bank,
        squad: squad.players.map((p) => ({
          player_id: p.player_id,
          position: p.position,
          club: p.club,
          purchase_price_tenths: p.purchase_price_tenths,
          selling_price_tenths: sellingPrice(p.purchase_price_tenths, p.price_tenths),
        })),
      };
      return {
        manager_id: squad.manager_id,
        starting,
        bench,
        captain: squad.captain,
        vice_captain: squad.vice_captain,
        chip: squad.chip,
        bank_tenths: squad.bank,
        transfers_made: squad.transfers_made,
        hit_points: squad.hit_points,
        snapshot_body: JSON.stringify(snapshot),
        free_transfers: freeTransfersAtDeadline(squad.free_transfers),
        notice: noticeText.deadlineLocked(number),
      };
    });
    await db.query(
      `INSERT INTO locked_teams (manager_id, gameweek, locked_at, starting, bench, captain, vice_captain, chip, bank_tenths,
                                 transfers_made, hit_points, snapshot_body, receipt)
       SELECT t.manager_id, $2, $3, t.starting, t.bench, t.captain, t.vice_captain, t.chip, t.bank_tenths, t.transfers_made, t.hit_points,
              t.snapshot_body, 'pending'
       FROM jsonb_to_recordset($1::jsonb) AS t(manager_id text, starting jsonb, bench jsonb, captain text, vice_captain text, chip text,
              bank_tenths integer, transfers_made integer, hit_points integer, snapshot_body text)`,
      [JSON.stringify(teams), number, lockedAt],
    );
    await db.query(
      `UPDATE squads s SET free_transfers = t.free_transfers
       FROM jsonb_to_recordset($1::jsonb) AS t(manager_id text, free_transfers integer) WHERE s.manager_id = t.manager_id`,
      [JSON.stringify(teams)],
    );
    await db.query(
      `INSERT INTO notice_outbox (manager_id, kind, gameweek, message)
       SELECT t.manager_id, 'deadline_locked', $2, t.notice FROM jsonb_to_recordset($1::jsonb) AS t(manager_id text, notice text)`,
      [JSON.stringify(teams), number],
    );
    await db.query("UPDATE drafts SET state = 'clean', out_ids = '[]', in_ids = '[]', refusal = NULL");
    await db.query("UPDATE gameweeks SET status = 'locked', locked_at = $2 WHERE number = $1", [number, now]);
    await publish(db, { t: "gameweek" });
    await publish(db, { t: "outbox" });
    await publish(db, { t: "snapshots" });
    return true;
  });
}

// A locked gameweek goes live at its first kickoff if the operator has not started it first.
async function kickOff(number: number): Promise<void> {
  await tx(async (db) => {
    const found = await db.query<{ status: GameweekStatus; first_kickoff: Date | null }>(
      "SELECT status, first_kickoff FROM gameweeks WHERE number = $1 FOR UPDATE",
      [number],
    );
    const row = found.rows[0]!;
    if (!canStep(row.status, "kickoff") || !deadlinePassed(row.first_kickoff, new Date())) return;
    await db.query("UPDATE gameweeks SET status = 'live' WHERE number = $1", [number]);
    await publish(db, { t: "gameweek" });
  });
}

let ticking = false;

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const due = await pool.query<{ number: number; status: string }>(
      `SELECT number, status FROM gameweeks
       WHERE (status = 'open' AND deadline <= $1) OR (status = 'locked' AND first_kickoff <= $1)`,
      [new Date()],
    );
    for (const gameweek of due.rows) {
      if (gameweek.status === "open") await lockGameweek(gameweek.number);
      else await kickOff(gameweek.number);
    }
  } catch (error) {
    console.error("lock tick:", (error as Error).message);
  } finally {
    ticking = false;
  }
}

export function startLockClock(): void {
  setInterval(() => void tick(), 200).unref();
}
