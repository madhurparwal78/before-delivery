// Holds: a party holds one table (or pair) for HOLD_SECONDS while it decides.
import type { HoldResponse, HoldStatus } from "../shared/api.js";
import { claimWindow, releaseWindow } from "./claims.js";
import { addMs, now } from "./clock.js";
import { config } from "./config.js";
import { pool, rows, transaction } from "./db.js";
import { depositCents } from "./domain/deposit.js";
import { holdRefusal } from "./domain/fit.js";
import { loadOccupancy } from "./domain/occupancy.js";
import { slotAvailability } from "./domain/slots.js";
import { turnWindow } from "./domain/turn.js";
import { apiErrors } from "./errors.js";
import { publishEvent } from "./events.js";
import { newToken } from "./ids.js";
import { slotInstant } from "./lisbon.js";
import { HOLD_COLUMNS, toHold, type HoldRow } from "./records.js";
import { requireAnswering } from "./valkey.js";
import { MESSAGES, objectBody, parseDate, parsePartySize, parseSlot, parseTarget, rejectInvalid } from "./validation.js";

/** A hold is live while the server's now is earlier than its expiry. */
export function effectiveStatus(row: Pick<HoldRow, "status" | "expires_at">, at: Date): HoldStatus {
  return row.status === "live" && at >= row.expires_at ? "expired" : row.status;
}

async function findHold(holdId: string): Promise<HoldRow> {
  const [hold] = await rows<HoldRow>(pool, `SELECT ${HOLD_COLUMNS} FROM holds WHERE hold_id = $1`, [holdId]);
  if (hold === undefined) throw apiErrors.notFound();
  return hold;
}

export async function placeHold(body: unknown): Promise<HoldResponse> {
  const at = now();
  const input = objectBody(body);
  const date = parseDate(input["date"], at);
  const time = parseSlot(input["time"]);
  const partySize = parsePartySize(input["party_size"]);
  const target = parseTarget(input["table_id"]);
  if (date === null || time === null || partySize === null || target === null) {
    throw rejectInvalid({
      date: [date, MESSAGES.date],
      time: [time, MESSAGES.time],
      party_size: [partySize, MESSAGES.party],
      table_id: [target, MESSAGES.table],
    });
  }

  const startsAt = slotInstant(date, time);
  if (!slotAvailability(startsAt, at).bookable) throw apiErrors.slotNotBookable();
  const window = turnWindow(partySize, startsAt);
  const refusal = holdRefusal(await loadOccupancy(pool, window.start, window.end, at), target, partySize, startsAt);
  if (refusal !== null) throw refusal;

  const holdId = newToken();
  const expiresAt = addMs(at, config.holdSeconds * 1000);
  if (!(await claimWindow(pool, holdId, target.tableIds, window, config.holdSeconds * 1000))) throw apiErrors.tableTaken();
  try {
    await pool.query(
      `INSERT INTO holds (hold_id, date, time, party_size, target_id, table_ids, status, deposit_cents, window_start, window_end, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'live', $7, $8, $9, $10)`,
      [holdId, date, time, partySize, target.targetId, target.tableIds, depositCents(partySize, target), window.start, window.end, expiresAt],
    );
  } catch (error) {
    await releaseWindow(holdId, target.tableIds, window).catch(() => undefined);
    throw error;
  }
  void publishEvent({ type: "hold.created", startsAt, tableIds: target.tableIds, partySize, expiresAt });
  return toHold(await findHold(holdId), "live", at);
}

export async function readHold(holdId: string): Promise<HoldResponse> {
  const at = now();
  const hold = await findHold(holdId);
  return toHold(hold, effectiveStatus(hold, at), at);
}

/** Frees the table at once; refused with 503 while Valkey is unreachable, leaving the hold live. */
export async function releaseHold(holdId: string): Promise<void> {
  const at = now();
  const hold = await findHold(holdId);
  if (hold.status === "released") return;
  if (hold.status === "confirmed") throw apiErrors.holdClosed();
  if (effectiveStatus(hold, at) === "expired") throw apiErrors.holdExpired();
  await requireAnswering();
  await releaseWindow(hold.hold_id, hold.table_ids, { start: hold.window_start, end: hold.window_end });
  const released = await transaction(async (client) => {
    const result = await client.query("UPDATE holds SET status = 'released' WHERE hold_id = $1 AND status = 'live'", [holdId]);
    if (result.rowCount === 1) {
      await client.query("INSERT INTO freed_tables (date, table_ids) VALUES ($1, $2)", [hold.date, hold.table_ids]);
    }
    return result.rowCount === 1;
  });
  if (released) {
    void publishEvent({ type: "hold.released", startsAt: hold.window_start, tableIds: hold.table_ids, partySize: hold.party_size });
  }
}

/** Marks every hold past its expiry as expired, removes its claims and publishes hold.expired. */
export async function expireHolds(): Promise<void> {
  const expired = await transaction(async (client) => {
    const ended = await rows<HoldRow>(
      client,
      `UPDATE holds SET status = 'expired'
        WHERE hold_id IN (SELECT hold_id FROM holds WHERE status = 'live' AND expires_at <= $1 FOR UPDATE SKIP LOCKED)
        RETURNING ${HOLD_COLUMNS}`,
      [now()],
    );
    for (const hold of ended) {
      await client.query("INSERT INTO freed_tables (date, table_ids) VALUES ($1, $2)", [hold.date, hold.table_ids]);
    }
    return ended;
  });
  for (const hold of expired) {
    await releaseWindow(hold.hold_id, hold.table_ids, { start: hold.window_start, end: hold.window_end }).catch(() => undefined);
    void publishEvent({ type: "hold.expired", startsAt: hold.window_start, tableIds: hold.table_ids, partySize: hold.party_size });
  }
}
