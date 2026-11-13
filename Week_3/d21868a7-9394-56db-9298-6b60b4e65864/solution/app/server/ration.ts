// Proportional ration of a window: the window's remaining ML shared among its candidate requested
// orders in proportion to each capped demand, in the same single step (and under the same lock) as
// placements, schedules and restriction publishes.
import { issueStartCard } from "./cards.ts";
import { tx, type Db } from "./db.ts";
import { flowRate, formatMl, lower, turnoutMaxVolume, type Milli } from "./decimal.ts";
import { ApiError, notFound } from "./http.ts";
import { queueRationNotices, type RationLine } from "./notices.ts";
import { nextStatus } from "./orderStates.ts";
import { shiftCounted } from "./orders.ts";
import { ORDER_SELECT, loadOrder, loadWindow, windowRecord, type OrderRow } from "./records.ts";
import { kickWorker } from "./worker.ts";

interface Demand {
  number: string;
  demand: Milli;
}

/** The shares: each demand when they all fit; otherwise d × R ÷ D rounded down to 0.001, with the
 * thousandths of R left over going one each to the largest discarded remainders (ties to the lower
 * order number), so the shares sum to exactly R. Demands arrive in order-number order. */
function shares(demands: Demand[], remaining: Milli): Map<string, Milli> {
  const total = demands.reduce((sum, d) => sum + d.demand, 0n);
  if (total <= remaining) return new Map(demands.map((d) => [d.number, d.demand]));
  const cut = demands.map((d, index) => ({ ...d, index, share: (d.demand * remaining) / total, rest: (d.demand * remaining) % total }));
  let leftover = remaining - cut.reduce((sum, d) => sum + d.share, 0n);
  const byRemainder = [...cut].sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
  for (const d of byRemainder) {
    if (leftover === 0n) break;
    d.share += 1n;
    leftover -= 1n;
  }
  return new Map(cut.map((d) => [d.number, d.share]));
}

/** Candidates: the window's requested orders whose turnout has no scheduled or running order, in
 * order-number order, at most one per turnout (the lowest number). */
async function candidates(db: Db, windowId: string): Promise<OrderRow[]> {
  const found = await db.query<OrderRow>(
    `${ORDER_SELECT}
     WHERE o.window_id = $1 AND o.status = 'requested'
       AND NOT EXISTS (SELECT 1 FROM water_order busy WHERE busy.turnout = o.turnout AND busy.status IN ('scheduled', 'running'))
     ORDER BY o.number`,
    [windowId],
  );
  const seen = new Set<string>();
  return found.rows.filter((o) => !seen.has(o.turnout) && seen.add(o.turnout));
}

/** Each candidate's demand: the lowest of its volume, its turnout's max volume for the window and its
 * grower's remaining allocation less the demands already given to that grower's earlier candidates,
 * never below 0. */
async function demands(db: Db, orders: OrderRow[], hours: number): Promise<Demand[]> {
  const left = new Map<number, Milli>();
  const growers = [...new Set(orders.map((o) => o.grower_id))].sort((a, b) => a - b);
  const allocations = await db.query<{ grower_id: number; left: Milli }>(
    "SELECT grower_id, allocation_milli - debited_milli AS left FROM allocation WHERE grower_id = ANY($1) ORDER BY grower_id",
    [growers],
  );
  for (const a of allocations.rows) left.set(a.grower_id, a.left);
  const limits = await db.query<{ code: string; max_rate_milli: Milli }>(
    "SELECT code, max_rate_milli FROM turnout WHERE code = ANY($1)",
    [orders.map((o) => o.turnout)],
  );
  const maxVolume = new Map(limits.rows.map((t) => [t.code, turnoutMaxVolume(t.max_rate_milli, hours)]));
  return orders.map((o) => {
    const available = left.get(o.grower_id)!;
    const demand = available > 0n ? lower(lower(o.volume_milli, maxVolume.get(o.turnout)!), available) : 0n;
    left.set(o.grower_id, available - demand);
    return { number: o.number, demand };
  });
}

export async function rationWindow(windowId: string) {
  const result = await tx(async (db) => {
    const window = await loadWindow(db, windowId);
    if (!window) throw notFound();
    if (window.status === "closed") throw new ApiError(409, "window_closed", "This window has closed.");
    const requested = await db.query("SELECT 1 FROM water_order WHERE window_id = $1 AND status = 'requested'", [windowId]);
    if (!requested.rowCount) throw new ApiError(409, "nothing_to_ration", "No requested orders to ration.");

    const orders = await candidates(db, windowId);
    const share = shares(await demands(db, orders, window.hours), window.remaining_milli);
    const now = new Date();
    const rationed: { order_number: string; requested_ml: string; volume_ml: string }[] = [];
    const lines: RationLine[] = [];
    for (const order of orders) {
      const volume = share.get(order.number)!;
      if (volume === 0n) {
        lines.push({ order, share: null });
        continue;
      }
      const rate = flowRate(volume, window.hours);
      await db.query(
        `UPDATE water_order SET status = $2, volume_milli = $3, rate_milli = $4, rationed = true, conflict = NULL, scheduled_at = $5
         WHERE number = $1`,
        [order.number, nextStatus("ration", order.status), volume, rate, now],
      );
      await shiftCounted(db, order, volume);
      await issueStartCard(db, { number: order.number, holder_code: order.holder_code, rate_milli: rate });
      rationed.push({ order_number: order.number, requested_ml: formatMl(order.requested_milli), volume_ml: formatMl(volume) });
      lines.push({ order: (await loadOrder(db, order.number))!, share: { volume, rate } });
    }
    const after = (await loadWindow(db, windowId))!;
    await queueRationNotices(db, after, lines);
    const left = await db.query<{ number: string }>(
      "SELECT number FROM water_order WHERE window_id = $1 AND status = 'requested' ORDER BY number",
      [windowId],
    );
    return { window: windowRecord(after), rationed, left_requested: left.rows.map((o) => o.number) };
  });
  kickWorker();
  return result;
}
