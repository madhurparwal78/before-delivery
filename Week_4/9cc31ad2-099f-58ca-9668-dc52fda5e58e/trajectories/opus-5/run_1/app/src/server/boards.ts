import { BOARD_SIZE, type BoardMode, type CarClass } from '../shared/catalogue.js';
import type { Queryable } from './db.js';
import { one } from './db.js';
import type { BoardRowBody } from './pushes.js';

export interface BoardBody {
  layoutId: string;
  mode: BoardMode;
  class: CarClass;
  rows: BoardRowBody[];
  mine: BoardRowBody | null;
}

interface BoardRowRecord {
  player_id: string;
  name: string;
  run_id: string;
  car_id: string;
  value: string;
  top_speed_mps: number;
  replay_sha256: string | null;
}

function orderClause(mode: BoardMode): string {
  return mode === 'drift' ? 'b.value desc' : 'b.value asc';
}

/** One row per player, in board order, with ranks and gaps computed here. */
export async function readBoard(
  tx: Queryable,
  layoutId: string,
  mode: BoardMode,
  className: CarClass,
  viewerId: string | null,
): Promise<BoardBody> {
  const { rows } = await tx.query<BoardRowRecord>(
    `select b.player_id, p.name, b.run_id, b.car_id, b.value::text as value, b.top_speed_mps,
            r.replay_sha256
     from board_rows b
     join players p on p.player_id = b.player_id
     join runs r on r.run_id = b.run_id
     where b.layout_id = $1 and b.mode = $2 and b.class = $3
     order by ${orderClause(mode)}, b.verified_at asc, b.seq asc`,
    [layoutId, mode, className],
  );
  const first = rows[0];
  const firstValue = first ? Number.parseInt(first.value, 10) : 0;
  const all: BoardRowBody[] = rows.map((row, index) => {
    const value = Number.parseInt(row.value, 10);
    return {
      rank: index + 1,
      playerId: row.player_id,
      name: row.name,
      runId: row.run_id,
      carId: row.car_id,
      value,
      unit: mode === 'drift' ? 'points' : 'ms',
      gapMs: mode === 'drift' || index === 0 ? null : value - firstValue,
      topSpeedMps: row.top_speed_mps,
      replaySha256: row.replay_sha256,
      mine: viewerId !== null && row.player_id === viewerId,
    };
  });
  return {
    layoutId,
    mode,
    class: className,
    rows: all.slice(0, BOARD_SIZE),
    mine: all.find((row) => row.mine) ?? null,
  };
}

export interface BoardCandidate {
  layoutId: string;
  mode: BoardMode;
  class: CarClass;
  playerId: string;
  runId: string;
  carId: string;
  value: number;
  topSpeedMps: number;
}

/** Keeps the player's best value on the board. Returns true when the row changed. */
export async function recordBoardValue(
  tx: Queryable,
  candidate: BoardCandidate,
): Promise<boolean> {
  const better = candidate.mode === 'drift' ? 'excluded.value > board_rows.value' : 'excluded.value < board_rows.value';
  const row = await one<{ run_id: string }>(
    tx,
    `insert into board_rows (layout_id, mode, class, player_id, run_id, car_id, value, top_speed_mps)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (layout_id, mode, class, player_id) do update
       set run_id = excluded.run_id, car_id = excluded.car_id, value = excluded.value,
           top_speed_mps = excluded.top_speed_mps, verified_at = now()
       where ${better}
     returning run_id`,
    [
      candidate.layoutId,
      candidate.mode,
      candidate.class,
      candidate.playerId,
      candidate.runId,
      candidate.carId,
      candidate.value,
      candidate.topSpeedMps,
    ],
  );
  return row !== null;
}
