/**
 * Every change of a unit's or a hold's state, and the queue of pending index updates that rides in the same
 * transaction. This is the one module that writes `released`, `withdrawn`, `reserved`, `price` and the hold statuses
 * (the lapse itself is `lapse.ts`); everything else calls these.
 */
import type { AppClock } from "./clock.js";
import type { Database, Queryable, Tx } from "./db.js";
import { ApiError } from "./errors.js";
import type { Indexer } from "./indexer.js";
import { lapseExpired } from "./lapse.js";
import type { UnitRow } from "./units.js";

export interface HoldRow {
  id: string;
  unit_code: string;
  account_id: string;
  status: "active" | "released" | "lapsed" | "converted";
  ended_by: "buyer" | "withdrawal" | "lapse" | "conversion" | null;
  quoted_price: number;
  price_version: number;
  created_at: Date;
  ends_at: Date;
  ended_at: Date | null;
  share_token: string | null;
}

/** Queues one pending index update per unit, in the caller's transaction. */
const queueIndexUpdates = async (tx: Queryable, codes: readonly string[], now: Date): Promise<void> => {
  if (codes.length === 0) return;
  await tx.query("INSERT INTO index_updates (unit_code, created_at) SELECT unnest($1::text[]), $2", [codes, now]);
};

/** Serialises every write on one unit. */
export const lockUnit = async (tx: Tx, code: string): Promise<void> => {
  await tx.query("SELECT code FROM units WHERE code = $1 FOR UPDATE", [code]);
};

/** The lapse check followed by waking the indexer when it freed any unit; returns the units freed. */
export const lapseAndNotify = async (db: Queryable, clock: AppClock, indexer: Indexer): Promise<string[]> => {
  const freed = await lapseExpired(db, clock.now());
  if (freed.length > 0) void indexer.tick();
  return freed;
};

export const startHold = async (tx: Tx, unit: UnitRow, accountId: string, now: Date, endsAt: Date): Promise<HoldRow> => {
  const created = await tx.query<HoldRow>(
    `INSERT INTO holds (unit_code, account_id, status, quoted_price, price_version, created_at, ends_at)
     VALUES ($1, $2, 'active', $3, $4, $5, $6) RETURNING *`,
    [unit.code, accountId, unit.price, unit.price_version, now, endsAt],
  );
  await queueIndexUpdates(tx, [unit.code], now);
  return created.rows[0] as HoldRow;
};

/** Ends an active hold (release, withdrawal or conversion) and queues the unit's index update. */
export const endHold = async (
  tx: Tx,
  holdId: string,
  unitCode: string,
  status: "released" | "converted",
  endedBy: "buyer" | "withdrawal" | "conversion",
  now: Date,
): Promise<HoldRow> => {
  const ended = await tx.query<HoldRow>(
    `UPDATE holds SET status = $2, ended_by = $3, ended_at = $4, share_token = NULL
      WHERE id = $1 AND status = 'active' RETURNING *`,
    [holdId, status, endedBy, now],
  );
  const row = ended.rows[0];
  if (row === undefined) throw new ApiError("hold_ended");
  await queueIndexUpdates(tx, [unitCode], now);
  return row;
};

export const convertHold = async (tx: Tx, hold: HoldRow, now: Date): Promise<HoldRow> => {
  await tx.query("UPDATE units SET reserved = true WHERE code = $1", [hold.unit_code]);
  return endHold(tx, hold.id, hold.unit_code, "converted", "conversion", now);
};

/** Withdraws a released, not yet withdrawn unit and ends any active hold on it. Returns false when the unit was not eligible. */
export const withdrawUnit = async (tx: Tx, unit: UnitRow, now: Date): Promise<boolean> => {
  const moved = await tx.query("UPDATE units SET withdrawn = true WHERE code = $1 AND released AND NOT withdrawn", [unit.code]);
  if (moved.rowCount === 0) return false;
  if (unit.active_hold_id !== null) await endHold(tx, unit.active_hold_id, unit.code, "released", "withdrawal", now);
  else await queueIndexUpdates(tx, [unit.code], now);
  return true;
};

/** Releases every unreleased unit of a band; returns the codes released (none when the band was already released). */
export const releaseBandUnits = async (tx: Tx, band: string, now: Date): Promise<string[]> => {
  const released = await tx.query<{ code: string }>("UPDATE units SET released = true WHERE band = $1 AND NOT released RETURNING code", [band]);
  const codes = released.rows.map((row) => row.code);
  await queueIndexUpdates(tx, codes, now);
  return codes;
};

/** Writes version `expected + 1` when the unit is still at `expected` and not withdrawn; returns it, or null when not. */
export const writePrice = async (
  tx: Tx,
  code: string,
  price: number,
  expected: number,
  setBy: string,
  now: Date,
): Promise<number | null> => {
  const moved = await tx.query<{ price_version: number }>(
    `UPDATE units SET price = $2, price_version = price_version + 1
      WHERE code = $1 AND price_version = $3 AND NOT withdrawn RETURNING price_version`,
    [code, price, expected],
  );
  const version = moved.rows[0]?.price_version;
  if (version === undefined) return null;
  await tx.query("INSERT INTO price_versions (unit_code, version, price, set_by, set_at) VALUES ($1, $2, $3, $4, $5)", [code, version, price, setBy, now]);
  await queueIndexUpdates(tx, [code], now);
  return version;
};

export const recordPhoto = async (tx: Tx, code: string, key: string, size: number, checksum: string, now: Date): Promise<boolean> => {
  const moved = await tx.query("UPDATE units SET view_key = $2, view_size = $3, view_checksum = $4 WHERE code = $1 AND NOT withdrawn", [code, key, size, checksum]);
  if (moved.rowCount === 0) return false;
  await queueIndexUpdates(tx, [code], now);
  return true;
};

/**
 * Runs `change` against an active hold with its unit locked and the lapse check applied first (a hold at or past its
 * end answers 409 `hold_ended` after the lapse is recorded). `ownerId` limits the hold to one buyer's own.
 */
export const withActiveHold = async <T>(
  db: Database,
  clock: AppClock,
  indexer: Indexer,
  holdId: string,
  ownerId: string | null,
  change: (tx: Tx, hold: HoldRow, now: Date) => Promise<T>,
): Promise<T> => {
  const outcome = await db.tx<T | ApiError>(async (tx) => {
    const found =
      ownerId === null
        ? await tx.query<HoldRow>("SELECT * FROM holds WHERE id = $1", [holdId])
        : await tx.query<HoldRow>("SELECT * FROM holds WHERE id = $1 AND account_id = $2", [holdId, ownerId]);
    const first = found.rows[0];
    if (first === undefined) return new ApiError("not_found");
    await lockUnit(tx, first.unit_code);
    const now = clock.now();
    await lapseExpired(tx, now);
    const current = (await tx.query<HoldRow>("SELECT * FROM holds WHERE id = $1", [holdId])).rows[0] as HoldRow;
    if (current.status !== "active") return new ApiError("hold_ended");
    return change(tx, current, now);
  });
  void indexer.tick();
  if (outcome instanceof ApiError) throw outcome;
  return outcome;
};
