// Seats: the confirmed limit comes from Kill Bill and is never more than 10 seconds old when used;
// the seat check itself is decided here and nowhere else.
import { one, query, tx, withLock, type Db } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import { liveBefore } from "./expiry.js";
import { route } from "./router.js";
import { emit } from "./events.js";
import { ownerOf } from "./outbox.js";
import { loadCalendar } from "./calendar.js";
import { billingDeadline, clearSchedule, ensureCatalog, ensureSeatsField, ensureSubscription, MissingSubscription, readSeatFields, scheduleSeats, writeSeats, type SeatFields } from "./killbill.js";
import { nowMs } from "./time.js";

const MAX_SEATS = 40;
const FRESH_MS = 10_000;
const PRICE_CENTS = 800;

interface WorkspaceBilling {
  id: string;
  name: string;
  seat_limit: number;
  seats_read_at: number;
  scheduled_limit: number | null;
  scheduled_on: string | null;
  kb_subscription_id: string | null;
}

async function billingRow(workspaceId: string): Promise<WorkspaceBilling> {
  return (await one<WorkspaceBilling>("SELECT id, name, seat_limit, seats_read_at, scheduled_limit, to_char(scheduled_on, 'YYYY-MM-DD') AS scheduled_on, kb_subscription_id FROM workspaces WHERE id = $1", [workspaceId])) as WorkspaceBilling;
}

let catalogReady = false;

/** Catalog, account, subscription and `seats` field for one workspace; idempotent. */
async function subscriptionOf(row: WorkspaceBilling): Promise<string> {
  if (!catalogReady) {
    await ensureCatalog();
    catalogReady = true;
  }
  if (row.kb_subscription_id) return row.kb_subscription_id;
  return withLock(`tr-billing:${row.id}`, async () => {
    const stored = await one<{ kb_subscription_id: string | null }>("SELECT kb_subscription_id FROM workspaces WHERE id = $1", [row.id]);
    if (stored?.kb_subscription_id) return stored.kb_subscription_id;
    const { accountId, subscriptionId } = await ensureSubscription(row.id, row.name);
    await ensureSeatsField(subscriptionId, row.seat_limit);
    await query("UPDATE workspaces SET kb_account_id = $2, kb_subscription_id = $3 WHERE id = $1", [row.id, accountId, subscriptionId]);
    return subscriptionId;
  });
}

/** Runs `work` against the workspace's subscription, resolving it again if Kill Bill lost it. */
async function onSubscription<T>(row: WorkspaceBilling, work: (subscriptionId: string) => Promise<T>): Promise<T> {
  try {
    return await work(await subscriptionOf(row));
  } catch (error) {
    if (!(error instanceof MissingSubscription)) throw error;
    await query("UPDATE workspaces SET kb_account_id = NULL, kb_subscription_id = NULL WHERE id = $1", [row.id]);
    return work(await subscriptionOf({ ...row, kb_subscription_id: null }));
  }
}

/** Registers every workspace with Kill Bill; boot retries this until it succeeds. */
export async function registerBilling(): Promise<void> {
  const rows = await query<{ id: string }>("SELECT id FROM workspaces ORDER BY slug");
  for (const { id } of rows) await confirmedLimit(id, true);
}

/** Records what Kill Bill just confirmed; every app copy reads the limit and its age from here. */
async function recordConfirmed(workspaceId: string, confirmed: SeatFields): Promise<void> {
  await query("UPDATE workspaces SET seat_limit = $2, seats_read_at = $3, scheduled_limit = $4, scheduled_on = $5 WHERE id = $1", [
    workspaceId,
    confirmed.seats,
    nowMs(),
    confirmed.scheduled?.limit ?? null,
    confirmed.scheduled?.on ?? null,
  ]);
}

/** Reads Kill Bill and applies a scheduled reduction that has come due. The caller holds the seat lock. */
async function readApplying(row: WorkspaceBilling, signal?: AbortSignal): Promise<SeatFields> {
  return onSubscription(row, async (subscriptionId) => {
    const fields = await readSeatFields(subscriptionId, signal);
    if (!fields.scheduled) return fields;
    const today = await tx(async (db) => (await loadCalendar(db, row.id)).today());
    if (fields.scheduled.on > today) return fields;
    const applied = await writeSeats(subscriptionId, fields.scheduled.limit, signal);
    await tx(async (db) => emit(db, row.id, "notice", {}, { recipients: await ownerOf(db, row.id) }));
    return applied;
  });
}

/** The seat limit as Kill Bill holds it; re-read when the stored copy is more than 10 s old or `force`. */
export async function confirmedLimit(workspaceId: string, force = false): Promise<number> {
  const row = await billingRow(workspaceId);
  if (!force && row.kb_subscription_id && nowMs() - row.seats_read_at < FRESH_MS) return row.seat_limit;
  return withLock(`tr-seats:${workspaceId}`, async () => {
    const confirmed = await readApplying(await billingRow(workspaceId));
    await recordConfirmed(workspaceId, confirmed);
    return confirmed.seats;
  });
}

interface SeatUse {
  active: number;
  pending: number;
}

export async function seatUse(db: Db, workspaceId: string): Promise<SeatUse> {
  const { rows } = await db.query<SeatUse>(
    `SELECT (SELECT count(*)::int FROM people WHERE workspace_id = $1) AS active,
            (SELECT count(*)::int FROM invites WHERE workspace_id = $1 AND status = 'pending' AND ${liveBefore("expires_at", "$2")}) AS pending`,
    [workspaceId, nowMs()],
  );
  return rows[0] as SeatUse;
}

/** The seat rule: an invite needs active + pending below the limit, an acceptance needs active
 * below it, and a new limit may not go below the active people. */
export function seatsAllow(use: SeatUse, limit: number, purpose: "invite" | "accept" | "new-limit"): boolean {
  if (purpose === "new-limit") return limit >= use.active;
  return (purpose === "invite" ? use.active + use.pending : use.active) < limit;
}

interface SeatSummary {
  limit: number;
  active: number;
  pending: number;
  billingOk: boolean;
}

/** Limit and usage for the owner; falls back to the last confirmed limit while Kill Bill is down. */
export async function seatSummary(workspaceId: string, force = false): Promise<SeatSummary> {
  let limit: number;
  let billingOk = true;
  try {
    limit = await confirmedLimit(workspaceId, force);
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "billing_unavailable") throw error;
    limit = (await billingRow(workspaceId)).seat_limit;
    billingOk = false;
  }
  const use = await tx((db) => seatUse(db, workspaceId));
  return { limit, ...use, billingOk };
}

function money(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

async function billingJson(workspaceId: string, summary: SeatSummary): Promise<Record<string, unknown>> {
  const row = await billingRow(workspaceId);
  return {
    limit: summary.limit,
    active: summary.active,
    pending: summary.pending,
    price_per_seat: money(PRICE_CENTS),
    currency: "USD",
    monthly_total: money(PRICE_CENTS * summary.limit),
    billing_status: summary.billingOk ? "ok" : "unavailable",
    account_external_key: `tallyroom-${workspaceId}`,
    scheduled_limit: row.scheduled_limit,
    scheduled_on: row.scheduled_on,
  };
}

route("GET", "/api/billing", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.owner();
  return { status: 200, body: await billingJson(viewer.workspaceId, await seatSummary(viewer.workspaceId, true)) };
});

/** A raise or the current limit takes effect at once and clears any schedule; a reduction waits for the paid period. */
async function changeSeats(row: WorkspaceBilling, current: number, seats: number, signal: AbortSignal): Promise<SeatFields> {
  return onSubscription(row, async (subscriptionId) => {
    if (seats < current) return scheduleSeats(subscriptionId, seats, signal);
    return seats === current ? clearSchedule(subscriptionId, signal) : writeSeats(subscriptionId, seats, signal);
  });
}

route("PUT", "/api/billing/seats", { access: "workspace", idempotent: true }, async (ctx) => {
  const viewer = ctx.owner();
  const seats = ctx.body.seats;
  if (typeof seats !== "number" || !Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS) throw invalid({ seats: "Choose between 1 and 40 seats." });
  const limit = await withLock(`tr-seats:${viewer.workspaceId}`, async () => {
    const signal = billingDeadline();
    const row = await billingRow(viewer.workspaceId);
    const before = await readApplying(row, signal);
    await recordConfirmed(viewer.workspaceId, before);
    if (!seatsAllow(await tx((db) => seatUse(db, viewer.workspaceId)), seats, "new-limit")) throw new ApiError("seats_below_active");
    const confirmed = await changeSeats(row, before.seats, seats, signal);
    if (confirmed.seats !== (seats < before.seats ? before.seats : seats)) throw new ApiError("billing_unavailable");
    await recordConfirmed(viewer.workspaceId, confirmed);
    return confirmed.seats;
  });
  const use = await tx((db) => seatUse(db, viewer.workspaceId));
  return { status: 200, body: await billingJson(viewer.workspaceId, { limit, ...use, billingOk: true }) };
});
