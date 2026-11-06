// Batches: the batch state machine and the maker's transitions.
import { type PoolClient } from "pg";
import { type BatchState } from "../core/catalog.js";
import { addDays, torontoDate, torontoLocalToInstant, dateDiffDays, dateToString } from "../core/toronto.js";
import { ApiError } from "../core/http.js";
import { batchTransitionMessage } from "../core/copy.js";
import type { Locale } from "../core/catalog.js";
import { DROP_SCENTS } from "../core/catalog.js";
import { fieldMessage } from "../core/copy.js";
import { addMovement, type BatchRow } from "./stock.js";

const PUBLIC_STATES: BatchState[] = ["scheduled", "live", "sold_out"];

export function isPublicState(state: string): boolean {
  return (PUBLIC_STATES as string[]).includes(state);
}

function transitionError(state: string, action: "cut" | "schedule" | "open" | "withdraw", locale: Locale): ApiError {
  const result = batchTransitionMessage(state as BatchState, action, locale);
  return new ApiError(409, result.code, result.message);
}

export async function getBatch(client: PoolClient, code: string): Promise<BatchRow | null> {
  const res = await client.query("SELECT * FROM batches WHERE code = $1", [code]);
  const row = res.rows[0] as (BatchRow & { poured_on: string | Date }) | undefined;
  if (!row) return null;
  return { ...row, poured_on: dateToString(row.poured_on) };
}

export interface LogLoafInput {
  scent: string;
  pouredOn: string;
  cureDays: number;
}

export async function logLoaf(client: PoolClient, locale: Locale, input: LogLoafInput): Promise<BatchRow> {
  if (!DROP_SCENTS.some((scent) => scent.slug === input.scent)) {
    throw new ApiError(422, "invalid", null, { scent: fieldMessage("scent", locale) });
  }
  const today = torontoDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.pouredOn) || input.pouredOn > today) {
    throw new ApiError(422, "invalid", null, { poured_on: fieldMessage("poured_on", locale) });
  }
  if (!Number.isInteger(input.cureDays) || input.cureDays < 28 || input.cureDays > 60) {
    throw new ApiError(422, "invalid", null, { cure_days: fieldMessage("cure_days", locale) });
  }
  const counter = await client.query("UPDATE counters SET value = value + 1 WHERE name = 'batch' RETURNING value");
  const code = `B-${String(counter.rows[0].value).padStart(4, "0")}`;
  await client.query(
    `INSERT INTO batches (code, scent, state, poured_on, cure_days, bars_cut, drop_at)
     VALUES ($1, $2, 'poured', $3, $4, 0, NULL)`,
    [code, input.scent, input.pouredOn, input.cureDays]
  );
  return (await getBatch(client, code))!;
}

export async function cutBatch(client: PoolClient, locale: Locale, code: string, bars: number): Promise<BatchRow> {
  const batch = await getBatch(client, code);
  if (!batch) throw new ApiError(404, "not_found");
  if (batch.state !== "poured") {
    throw transitionError(batch.state, "cut", locale);
  }
  if (!Number.isInteger(bars) || bars < 1 || bars > 24) {
    throw new ApiError(422, "invalid", null, { bars: fieldMessage("bars_cut", locale) });
  }
  await client.query("UPDATE batches SET bars_cut = $2, state = 'curing' WHERE code = $1", [code, bars]);
  await addMovement(client, code, "cut", Array.from({ length: bars }, (_, i) => i + 1), null);
  return (await getBatch(client, code))!;
}

export async function scheduleBatch(
  client: PoolClient,
  locale: Locale,
  code: string,
  dropAtLocal: string
): Promise<BatchRow> {
  const batch = await getBatch(client, code);
  if (!batch) throw new ApiError(404, "not_found");
  if (batch.state !== "curing" && batch.state !== "scheduled") {
    throw transitionError(batch.state, "schedule", locale);
  }
  const fields = await scheduleFields(locale, batch, dropAtLocal);
  await client.query("UPDATE batches SET state = 'scheduled', drop_at = $2 WHERE code = $1", [code, fields.instant]);
  return (await getBatch(client, code))!;
}

async function scheduleFields(locale: Locale, batch: BatchRow, dropAtLocal: string): Promise<{ instant: Date }> {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dropAtLocal)) {
    throw new ApiError(422, "invalid", null, { drop_at_local: fieldMessage("drop_at_local_format", locale) });
  }
  const conversion = torontoLocalToInstant(dropAtLocal);
  if (conversion.gap || !conversion.instant) {
    throw new ApiError(422, "invalid", null, { drop_at_local: fieldMessage("drop_at_local_gap", locale) });
  }
  const instant = conversion.instant;
  if (instant.getTime() <= Date.now()) {
    throw new ApiError(422, "invalid", null, { drop_at_local: fieldMessage("drop_at_local_past", locale) });
  }
  const cureDate = addDays(dateToString(batch.poured_on), batch.cure_days);
  if (dateDiffDays(dropAtLocal.slice(0, 10), cureDate) < 0) {
    throw new ApiError(422, "invalid", null, {
      drop_at_local: fieldMessage("drop_at_local_before_cure", locale, { date: cureDate })
    });
  }
  return { instant };
}

export async function openBatch(client: PoolClient, locale: Locale, code: string): Promise<BatchRow> {
  const batch = await getBatch(client, code);
  if (!batch) throw new ApiError(404, "not_found");
  if (batch.state !== "curing" && batch.state !== "scheduled") {
    throw transitionError(batch.state, "open", locale);
  }
  const cureDate = addDays(dateToString(batch.poured_on), batch.cure_days);
  const today = torontoDate(new Date());
  if (dateDiffDays(today, cureDate) < 0) {
    throw new ApiError(422, "invalid", null, {
      drop_at_local: fieldMessage("open_not_cured", locale, { date: cureDate })
    });
  }
  await client.query("UPDATE batches SET state = 'live', drop_at = now() WHERE code = $1", [code]);
  return (await getBatch(client, code))!;
}

export async function withdrawBatch(client: PoolClient, locale: Locale, code: string): Promise<BatchRow> {
  const batch = await getBatch(client, code);
  if (!batch) throw new ApiError(404, "not_found");
  if (batch.state !== "poured" && batch.state !== "curing" && batch.state !== "scheduled" && batch.state !== "live") {
    throw transitionError(batch.state, "withdraw", locale);
  }
  await client.query("UPDATE batches SET state = 'withdrawn' WHERE code = $1", [code]);
  await client.query(
    `UPDATE holds SET status = 'released'
     WHERE batch_code = $1 AND status = 'active'`,
    [code]
  );
  return (await getBatch(client, code))!;
}

/** A scheduled batch goes live at its drop time; called from the background loop. */
export async function activateDueBatches(pool: PoolClient): Promise<void> {
  await pool.query(
    "UPDATE batches SET state = 'live' WHERE state = 'scheduled' AND drop_at IS NOT NULL AND drop_at <= now()"
  );
}

