// Placing, cancelling, scheduling, closing and reopening orders. Every change to an order's counted
// volume moves the window's committed figure and the grower's debited figure in the same step.
import type { User } from "./auth.ts";
import { read, tx, type Db } from "./db.ts";
import { VOLUME_MAX, flowRate, formatMl, parseMl, turnoutMaxVolume, type Milli } from "./decimal.ts";
import { ApiError, FieldErrors, ValidationError, asRecord, notFound } from "./http.ts";
import { issueStartCard } from "./cards.ts";
import { queueConflictNotice, queueLapseNotices, type LapsedOrder } from "./notices.ts";
import { nextStatus } from "./orderStates.ts";
import {
  allocationRecord,
  loadOrder,
  loadWindow,
  ORDER_SELECT,
  orderRecord,
  windowRecord,
  type OrderRow,
  type WindowFigures,
} from "./records.ts";
import { nextNumber } from "./schema.ts";
import { orderingHorizon } from "./time.ts";
import { kickWorker } from "./worker.ts";

const windowClosed = () => new ApiError(409, "window_closed", "This window has closed.");
const turnoutBusy = () => new ApiError(409, "turnout_busy", "This turnout already has an order scheduled or running.");
const allocationCopy = (remaining: Milli) => `More than your remaining allocation of ${formatMl(remaining)} ML.`;
const volumeCopy = "Enter a volume above 0 and at most 500.000 ML, with up to three decimals.";
const turnoutCopy = "Choose one of your turnouts on this window's channel.";
const turnoutLimitCopy = (code: string, max: Milli) => `More than ${code} can pass in this window: ${formatMl(max)} ML.`;

interface TurnoutRow {
  code: string;
  channel_id: string;
  max_rate_milli: Milli;
}

async function ownTurnout(db: Db, growerId: number, code: unknown): Promise<TurnoutRow | undefined> {
  if (typeof code !== "string") return undefined;
  const found = await db.query<TurnoutRow>(
    "SELECT code, channel_id, max_rate_milli FROM turnout WHERE code = $1 AND grower_id = $2",
    [code, growerId],
  );
  return found.rows[0];
}

/** The outlet limit: a volume above the turnout's max volume for the window is refused on `volume_ml`. */
function checkOutletLimit(errors: FieldErrors, turnout: TurnoutRow, w: WindowFigures, volume: Milli): void {
  const max = turnoutMaxVolume(turnout.max_rate_milli, w.hours);
  if (volume > max) errors.add("volume_ml", turnoutLimitCopy(turnout.code, max));
}

/** A grower reaches the windows of the channels they have turnouts on. */
async function growerReaches(db: Db, growerId: number, channelId: string): Promise<boolean> {
  const found = await db.query("SELECT 1 FROM turnout WHERE grower_id = $1 AND channel_id = $2", [growerId, channelId]);
  return Boolean(found.rowCount);
}

/** A valid order volume, else null. */
function orderVolume(value: unknown): Milli | null {
  const volume = parseMl(value);
  return volume === null || volume <= 0n || volume > VOLUME_MAX ? null : volume;
}

/** An operator who exists and has not been erased may be nominated. */
async function usableOperator(db: Db, code: unknown): Promise<boolean> {
  if (typeof code !== "string") return false;
  const found = await db.query("SELECT 1 FROM person WHERE operator_code = $1 AND NOT erased", [code]);
  return Boolean(found.rowCount);
}

async function turnoutHasLiveOrder(db: Db, turnout: string, except: string | null): Promise<boolean> {
  const found = await db.query(
    "SELECT 1 FROM water_order WHERE turnout = $1 AND status IN ('scheduled', 'running') AND number IS DISTINCT FROM $2",
    [turnout, except],
  );
  return Boolean(found.rowCount);
}

async function remainingAllocation(db: Db, growerId: number): Promise<Milli> {
  const found = await db.query<{ left: Milli }>(
    "SELECT allocation_milli - debited_milli AS left FROM allocation WHERE grower_id = $1",
    [growerId],
  );
  return found.rows[0]!.left;
}

/** Moves `volume` into (positive) or out of (negative) the window and the grower's allocation together. */
export async function shiftCounted(db: Db, order: Pick<OrderRow, "window_id" | "grower_id">, volume: Milli): Promise<void> {
  await db.query("UPDATE delivery_window SET committed_milli = committed_milli + $2 WHERE id = $1", [order.window_id, volume]);
  await db.query("UPDATE allocation SET debited_milli = debited_milli + $2 WHERE grower_id = $1", [order.grower_id, volume]);
}

/** Removes the order's unspent start card from every list, so a later confirmation cannot start it. */
async function withdrawStartCard(db: Db, number: string): Promise<void> {
  await db.query("DELETE FROM gate_card WHERE order_number = $1 AND kind = 'start' AND state <> 'spent'", [number]);
}

/** Releases a scheduled order's volume and allocation and removes its open start card. */
export async function releaseScheduled(db: Db, order: OrderRow): Promise<void> {
  await shiftCounted(db, order, -order.volume_milli);
  await withdrawStartCard(db, order.number);
}

type Refusal = { kind: "full"; window: WindowFigures; growerId: number; turnout: string; volume: Milli; allocationLeft: Milli };

/** Records the conflict notice for a `window_full` refusal in its own step, then answers 409. */
async function refuseFull(refusal: Refusal): Promise<never> {
  await tx(async (db) => queueConflictNotice(db, refusal));
  kickWorker();
  throw new ApiError(409, "window_full", "Not enough capacity left in this window.", {
    remaining_ml: formatMl(refusal.window.remaining_milli),
  });
}

export async function placeOrder(user: User, body: unknown) {
  const input = asRecord(body);
  const outcome = await tx(async (db) => {
    const turnout = await ownTurnout(db, user.id, input.turnout);
    if (typeof input.turnout === "string" && !turnout) throw notFound();
    const window = typeof input.window_id === "string" ? await loadWindow(db, input.window_id) : null;
    if (typeof input.window_id === "string" && (!window || !(await growerReaches(db, user.id, window.channel_id)))) {
      throw notFound();
    }

    const errors = new FieldErrors();
    if (!turnout) errors.add("turnout", "Choose a turnout.");
    if (!window) errors.add("window_id", "Choose a delivery window.");
    const sameChannel = Boolean(turnout && window && turnout.channel_id === window.channel_id);
    if (turnout && window && !sameChannel) errors.add("turnout", turnoutCopy);
    const volume = orderVolume(input.volume_ml);
    if (volume === null) errors.add("volume_ml", volumeCopy);
    else if (sameChannel) checkOutletLimit(errors, turnout!, window!, volume);
    if (!(await usableOperator(db, input.operator_code))) errors.add("operator_code", "Choose an operator who can work the gate.");
    const standby = input.standby_code ?? null;
    if (standby !== null && !(await usableOperator(db, standby))) errors.add("standby_code", "Choose a standby who can work the gate.");
    if (standby !== null && standby === input.operator_code) errors.add("standby_code", "The standby must differ from the gate operator.");
    const left = await remainingAllocation(db, user.id);
    if (volume !== null && volume > left) errors.add("volume_ml", allocationCopy(left));
    errors.throwIfAny();

    const w = window!;
    const horizon = orderingHorizon(w.opens_at, w.closes_at, new Date());
    if (horizon === "too_early") throw new ApiError(409, "too_early", "Orders open 10 days before a window opens.");
    if (horizon === "window_closed") throw windowClosed();
    if (await turnoutHasLiveOrder(db, turnout!.code, null)) throw turnoutBusy();
    if (volume! > w.remaining_milli) {
      return { kind: "full", window: w, growerId: user.id, turnout: turnout!.code, volume: volume!, allocationLeft: left } satisfies Refusal;
    }

    const order: OrderRow = {
      number: `ORD-${String(await nextNumber(db, "order")).padStart(5, "0")}`,
      grower_id: user.id,
      grower_name: user.name,
      turnout: turnout!.code,
      window_id: w.id,
      requested_milli: volume!,
      volume_milli: volume!,
      rate_milli: flowRate(volume!, w.hours),
      status: "scheduled",
      holder_code: input.operator_code as string,
      standby_code: standby as string | null,
      conflict: null,
      closed_after_flow: false,
      rationed: false,
      scheduled_at: new Date(),
    };
    await db.query(
      `INSERT INTO water_order (number, grower_id, turnout, window_id, requested_milli, volume_milli, rate_milli, status, holder_code, standby_code, scheduled_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10)`,
      [order.number, order.grower_id, order.turnout, order.window_id, order.volume_milli, order.rate_milli,
        order.status, order.holder_code, order.standby_code, order.scheduled_at],
    );
    await shiftCounted(db, order, order.volume_milli);
    await issueStartCard(db, order);
    return {
      kind: "placed",
      body: { order: orderRecord(order), window: windowRecord((await loadWindow(db, w.id))!), allocation: await allocationRecord(db, user.id) },
    } as const;
  });
  if (outcome.kind === "full") return refuseFull(outcome);
  return outcome.body;
}

/** What an order of the queried volume would run at in the queried window, by the one conversion rule. */
export async function quoteOrder(db: Db, user: User, query: URLSearchParams) {
  const windowId = query.get("window");
  if (!windowId) throw new ValidationError({ window: "Choose a delivery window." });
  const window = await loadWindow(db, windowId);
  if (!window || !(await growerReaches(db, user.id, window.channel_id))) throw notFound();
  const errors = new FieldErrors();
  const turnoutCode = query.get("turnout");
  const turnout = turnoutCode === null ? undefined : await ownTurnout(db, user.id, turnoutCode);
  const onChannel = turnout !== undefined && turnout.channel_id === window.channel_id;
  if (turnoutCode !== null && !onChannel) errors.add("turnout", turnoutCopy);
  const volume = orderVolume(query.get("volume_ml"));
  if (volume === null) errors.add("volume_ml", volumeCopy);
  else if (onChannel) checkOutletLimit(errors, turnout!, window, volume);
  errors.throwIfAny();
  return {
    rate_ml_day: formatMl(flowRate(volume!, window.hours)),
    turnout_max_ml: onChannel ? formatMl(turnoutMaxVolume(turnout!.max_rate_milli, window.hours)) : null,
    window: windowRecord(window),
  };
}

/** The lapse at a window's close: from the first request at or after `closes_at`, its requested and
 * scheduled orders read closed with conflict `lapsed`, a scheduled one's volume, allocation and start
 * card released, and one lapse notice per grower and window queued in the same step. Running orders stay running. */
export async function lapseClosedWindows(): Promise<void> {
  const due = `
    ${ORDER_SELECT} JOIN delivery_window w ON w.id = o.window_id
    WHERE o.status IN ('requested', 'scheduled') AND w.closes_at <= $1 ORDER BY o.number`;
  const now = new Date();
  if (!(await read((db) => db.query(`${due} LIMIT 1`, [now]))).rowCount) return;
  await tx(async (db) => {
    const lapsed: LapsedOrder[] = [];
    for (const order of (await db.query<OrderRow>(due, [now])).rows) {
      const status = nextStatus("lapse", order.status);
      lapsed.push({ order, window: (await loadWindow(db, order.window_id))! });
      if (order.status === "scheduled") await releaseScheduled(db, order);
      await db.query("UPDATE water_order SET status = $2, conflict = 'lapsed', closed_after_flow = false WHERE number = $1", [
        order.number, status,
      ]);
    }
    await queueLapseNotices(db, lapsed);
  });
  kickWorker();
}

export async function cancelOrder(user: User, number: string) {
  return tx(async (db) => {
    const order = await loadOrder(db, number);
    if (!order || order.grower_id !== user.id) throw notFound();
    const status = nextStatus("cancel", order.status);
    if (order.status === "scheduled") await releaseScheduled(db, order);
    await db.query("UPDATE water_order SET status = $2 WHERE number = $1", [number, status]);
    return {
      order: orderRecord((await loadOrder(db, number))!),
      window: windowRecord((await loadWindow(db, order.window_id))!),
      allocation: await allocationRecord(db, user.id),
    };
  });
}

async function dispatcherMove<T>(number: string, work: (db: Db, order: OrderRow, window: WindowFigures) => Promise<T>) {
  return tx(async (db) => {
    const order = await loadOrder(db, number);
    if (!order) throw notFound();
    const result = await work(db, order, (await loadWindow(db, order.window_id))!);
    return { result, order: orderRecord((await loadOrder(db, number))!), window: windowRecord((await loadWindow(db, order.window_id))!) };
  });
}

export async function scheduleOrder(number: string) {
  const outcome = await dispatcherMove(number, async (db, order, w): Promise<Refusal | null> => {
    const status = nextStatus("schedule", order.status);
    if (w.status === "closed") throw windowClosed();
    if (await turnoutHasLiveOrder(db, order.turnout, order.number)) throw turnoutBusy();
    const left = await remainingAllocation(db, order.grower_id);
    if (order.volume_milli > left) {
      throw new ApiError(409, "allocation_exceeded", "This grower does not have enough allocation left.");
    }
    if (order.volume_milli > w.remaining_milli) {
      return { kind: "full", window: w, growerId: order.grower_id, turnout: order.turnout, volume: order.volume_milli, allocationLeft: left };
    }
    await db.query("UPDATE water_order SET status = $2, scheduled_at = now(), conflict = NULL WHERE number = $1", [number, status]);
    await shiftCounted(db, order, order.volume_milli);
    await issueStartCard(db, order);
    return null;
  });
  if (outcome.result) return refuseFull(outcome.result);
  return { order: outcome.order, window: outcome.window };
}

export async function closeOrder(number: string) {
  const { order, window } = await dispatcherMove(number, async (db, order) => {
    const status = nextStatus("close", order.status);
    if (order.status === "scheduled") await releaseScheduled(db, order);
    await db.query("UPDATE water_order SET status = $2, closed_after_flow = $3 WHERE number = $1", [
      number, status, order.status === "running",
    ]);
  });
  return { order, window };
}

export async function reopenOrder(number: string) {
  const { order, window } = await dispatcherMove(number, async (db, order, w) => {
    const status = nextStatus("reopen", order.status);
    const finish = await db.query("SELECT 1 FROM gate_card WHERE order_number = $1 AND kind = 'finish' AND state = 'open'", [number]);
    if (!order.closed_after_flow || !finish.rowCount) {
      throw new ApiError(409, "not_reopenable", "This order cannot be reopened.");
    }
    if (w.status === "closed") throw windowClosed();
    if (await turnoutHasLiveOrder(db, order.turnout, order.number)) throw turnoutBusy();
    await db.query("UPDATE water_order SET status = $2, closed_after_flow = false WHERE number = $1", [number, status]);
  });
  return { order, window };
}

export async function listOrders(db: Db, user: User, windowId: string | null) {
  const found = await db.query<OrderRow>(
    `${ORDER_SELECT} WHERE ($1::int IS NULL OR o.grower_id = $1) AND ($2::text IS NULL OR o.window_id = $2)
     ORDER BY o.number DESC`,
    [user.role === "grower" ? user.id : null, windowId],
  );
  return found.rows.map(orderRecord);
}

export async function getOrder(db: Db, user: User, number: string) {
  const order = await loadOrder(db, number);
  if (!order || (user.role === "grower" && order.grower_id !== user.id)) throw notFound();
  return orderRecord(order);
}
