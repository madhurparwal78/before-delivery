import type { CarClass, LayoutId } from "../shared/model.js";
import { BOARD_SIZE } from "../shared/rules.js";
import type { Database, Transaction } from "./db.js";
import { Hub } from "./push.js";

export type BoardMode = "time-trial" | "circuit" | "drift";
export const BOARD_MODES: readonly BoardMode[] = ["time-trial", "circuit", "drift"];

export interface BoardRow {
  rank: number;
  playerId: string;
  name: string;
  runId: string;
  carId: string;
  value: number;
  unit: "ms" | "points";
  gapMs: number | null;
  topSpeedMps: number;
  replaySha256: string;
  mine: boolean;
}

interface RankedRow {
  [key: string]: unknown;
  rank: string;
  first_value: number;
  player_id: string;
  name: string;
  run_id: string;
  car_id: string;
  value: number;
  top_speed: number;
  replay_sha256: string;
}

// Times rank ascending, drift scores descending; ties go to the earlier verification.
function rankedSql(mode: BoardMode, filter: string): string {
  const order = `value ${mode === "drift" ? "DESC" : "ASC"}, verified_at ASC, run_id ASC`;
  return `SELECT * FROM (
      SELECT b.player_id, p.name, b.run_id, b.car_id, b.value, b.top_speed, b.replay_sha256,
             ROW_NUMBER() OVER (ORDER BY ${order}) AS rank, FIRST_VALUE(b.value) OVER (ORDER BY ${order}) AS first_value
        FROM board_rows b JOIN players p ON p.id = b.player_id
       WHERE b.layout_id = $1 AND b.mode = $2 AND b.class = $3) ranked ${filter} ORDER BY rank`;
}

function toRow(mode: BoardMode, row: RankedRow, viewerId: string | null): BoardRow {
  const rank = Number(row.rank);
  return {
    rank, playerId: row.player_id, name: row.name, runId: row.run_id, carId: row.car_id, value: row.value,
    unit: mode === "drift" ? "points" : "ms",
    gapMs: mode === "drift" || rank === 1 ? null : row.value - row.first_value,
    topSpeedMps: row.top_speed, replaySha256: row.replay_sha256, mine: row.player_id === viewerId,
  };
}

export async function board(db: Database, layoutId: LayoutId, mode: BoardMode, carClass: CarClass, viewerId: string) {
  const top = await db.query<RankedRow>(rankedSql(mode, `WHERE rank <= ${BOARD_SIZE}`), [layoutId, mode, carClass]);
  const [mine] = await db.query<RankedRow>(rankedSql(mode, "WHERE player_id = $4"), [layoutId, mode, carClass, viewerId]);
  return {
    layoutId, mode, class: carClass,
    rows: top.map((row) => toRow(mode, row, viewerId)),
    mine: mine ? toRow(mode, mine, viewerId) : null,
  };
}

interface BoardEntry {
  readonly layoutId: LayoutId;
  readonly mode: BoardMode;
  readonly class: CarClass;
  readonly playerId: string;
  readonly runId: string;
  readonly carId: string;
  readonly value: number;
  readonly topSpeedMps: number;
  readonly replaySha256: string;
}

// Keeps the player's one row at their best value; a better value moves it and is pushed live.
export async function offerBoardEntry(tx: Transaction, entry: BoardEntry): Promise<void> {
  const better = entry.mode === "drift" ? ">" : "<";
  const written = await tx.query(
    `INSERT INTO board_rows (layout_id, mode, class, player_id, run_id, value, top_speed, replay_sha256, car_id, verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, clock_timestamp())
     ON CONFLICT (layout_id, mode, class, player_id) DO UPDATE SET
       run_id = EXCLUDED.run_id, value = EXCLUDED.value, top_speed = EXCLUDED.top_speed,
       replay_sha256 = EXCLUDED.replay_sha256, car_id = EXCLUDED.car_id, verified_at = EXCLUDED.verified_at
     WHERE EXCLUDED.value ${better} board_rows.value
     RETURNING player_id`,
    [entry.layoutId, entry.mode, entry.class, entry.playerId, entry.runId, entry.value, entry.topSpeedMps,
      entry.replaySha256, entry.carId]);
  if (written.length === 0) return;
  const [row] = await tx.query<RankedRow>(rankedSql(entry.mode, "WHERE player_id = $4"),
    [entry.layoutId, entry.mode, entry.class, entry.playerId]);
  await Hub.queue(tx, {
    to: null,
    push: { type: "board", layoutId: entry.layoutId, mode: entry.mode, class: entry.class, row: toRow(entry.mode, row, entry.playerId) },
  });
}
