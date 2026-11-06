import { TRADES, type Costs, type Trade } from "../shared/domain";
import { contingencyOf, lineTotal, sumMoney } from "../shared/money";
import { maybeOne, one, rows, sequence, type Db } from "./db";

// The one cost rollup: items by room and by trade at their current line totals, change
// orders approved by the moment asked for, and one contingency on the job total at the
// percent in effect then. The Costs tab, the costs endpoint and the costs event read it.

const TRADE_ORDER: readonly (Trade | null)[] = [...TRADES, null];

export async function computeCosts(db: Db, jobId: string, asOf: string | null): Promise<Costs> {
  const moment = asOf ?? (await one<{ now: string }>(db, "SELECT clock_timestamp() AS now")).now;
  const [rooms, items, approved, setting] = await sequence(
    () => rows<{ id: string; name: string }>(db, "SELECT id, name FROM rooms WHERE job_id = $1 ORDER BY position", [jobId]),
    () =>
      rows<{ room_id: string; trade: Trade | null; quantity: string | null; unit_cost: string | null }>(
        db,
        "SELECT room_id, trade, quantity, unit_cost FROM items WHERE job_id = $1",
        [jobId],
      ),
    () => rows<{ amount: string }>(db, "SELECT amount FROM change_orders WHERE job_id = $1 AND approved_at <= $2", [jobId, moment]),
    () =>
      maybeOne<{ percent: string }>(
        db,
        "SELECT percent FROM contingency_settings WHERE job_id = $1 AND effective_at <= $2 ORDER BY effective_at DESC, id DESC LIMIT 1",
        [jobId, moment],
      ),
  );
  const lines = items.map((item) => ({ ...item, total: lineTotal(item.quantity, item.unit_cost) }));
  const itemsSubtotal = sumMoney(lines.map((line) => line.total));
  const changeOrdersTotal = sumMoney(approved.map((order) => order.amount));
  const percent = setting?.percent ?? "0.00";
  const contingency = contingencyOf(sumMoney([itemsSubtotal, changeOrdersTotal]), percent);
  return {
    as_of: moment,
    by_room: rooms.map((room) => ({
      room_id: room.id,
      name: room.name,
      subtotal: sumMoney(lines.filter((line) => line.room_id === room.id).map((line) => line.total)),
    })),
    by_trade: TRADE_ORDER.map((trade) => ({
      trade,
      subtotal: sumMoney(lines.filter((line) => line.trade === trade).map((line) => line.total)),
    })),
    items_subtotal: itemsSubtotal,
    change_orders_total: changeOrdersTotal,
    contingency_percent: percent,
    contingency,
    total: sumMoney([itemsSubtotal, changeOrdersTotal, contingency]),
  };
}
