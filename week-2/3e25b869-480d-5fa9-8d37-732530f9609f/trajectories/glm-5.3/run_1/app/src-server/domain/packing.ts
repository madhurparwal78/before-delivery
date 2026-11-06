// Packing: today's list under the cutoff, and marking an order shipped with
// the rule that exactly one shipment wins.
import { type Pool, type PoolClient } from "pg";
import { ApiError } from "../core/http.js";
import type { Locale } from "../core/catalog.js";
import { message } from "../core/copy.js";
import { torontoDate, dateToString } from "../core/toronto.js";
import type { PackingOrderView } from "./views.js";

export interface PackingRow {
  number: string;
  ship_on: string;
  name: string;
  line1: string;
  city: string;
  province: string;
  postal_code: string;
  bars: { batch: string; scent: string; bar: number }[];
  fulfilment: string;
  version: number;
}

export async function packingList(client: PoolClient): Promise<{ date: string; cutoffLocal: string; orders: PackingRow[] }> {
  const cutoffRes = await client.query("SELECT value FROM settings WHERE key = 'packing_cutoff_local'");
  const cutoffLocal = (cutoffRes.rows[0]?.value as string) ?? "14:00";
  const date = torontoDate(new Date());
  const res = await client.query(
    `SELECT o.number, o.ship_on, o.name, o.line1, o.city, o.province, o.postal_code, o.fulfilment, o.version
     FROM orders o
     WHERE o.fulfilment = 'to_pack' AND o.status <> 'refunded' AND o.ship_on <= $1
     ORDER BY o.ship_on, o.number`,
    [date]
  );
  const orders: PackingRow[] = [];
  for (const row of res.rows) {
    const bars = await client.query(
      `SELECT batch_code, scent, bar FROM order_lines
       WHERE order_id = (SELECT id FROM orders WHERE number = $1) AND refunded = false
       ORDER BY batch_code, bar`,
      [row.number]
    );
    orders.push({
      number: row.number,
      ship_on: dateToString(row.ship_on as string | Date),
      name: row.name,
      line1: row.line1,
      city: row.city,
      province: row.province,
      postal_code: row.postal_code,
      bars: bars.rows.map((bar) => ({ batch: bar.batch_code, scent: bar.scent, bar: bar.bar })),
      fulfilment: row.fulfilment,
      version: row.version
    });
  }
  return { date, cutoffLocal, orders };
}

export function packingView(row: PackingRow): PackingOrderView {
  return {
    number: row.number,
    ship_on: row.ship_on,
    name: row.name,
    address: { line1: row.line1, city: row.city, province: row.province, postal_code: row.postal_code },
    bars: row.bars,
    fulfilment: row.fulfilment,
    version: row.version
  };
}

export async function shipOrder(
  pool: Pool,
  locale: Locale,
  orderNumber: string
): Promise<PackingRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query("SELECT * FROM orders WHERE number = $1 FOR UPDATE", [orderNumber]);
    const row = res.rows[0];
    if (!row) {
      throw new ApiError(404, "not_found");
    }
    if (row.status === "refunded") {
      throw new ApiError(409, "order_refunded", message("order_refunded", locale, { order: orderNumber }));
    }
    if (row.fulfilment === "shipped") {
      throw new ApiError(409, "already_shipped", message("already_shipped", locale, { order: orderNumber }));
    }
    await client.query(
      "UPDATE orders SET fulfilment = 'shipped', version = version + 1 WHERE number = $1",
      [orderNumber]
    );
    await client.query("COMMIT");
    const bars = await client.query(
      `SELECT batch_code, scent, bar FROM order_lines
       WHERE order_id = (SELECT id FROM orders WHERE number = $1) AND refunded = false
       ORDER BY batch_code, bar`,
      [orderNumber]
    );
    return {
      number: row.number,
      ship_on: dateToString(row.ship_on as string | Date),
      name: row.name,
      line1: row.line1,
      city: row.city,
      province: row.province,
      postal_code: row.postal_code,
      bars: bars.rows.map((bar) => ({ batch: bar.batch_code, scent: bar.scent, bar: bar.bar })),
      fulfilment: "shipped",
      version: (row.version as number) + 1
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    throw err;
  }
}
