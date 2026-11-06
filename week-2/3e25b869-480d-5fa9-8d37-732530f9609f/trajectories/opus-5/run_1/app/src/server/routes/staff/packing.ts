import { STUDIO } from '../../../shared/copy.js';
import { torontoDate } from '../../../shared/toronto.js';
import type { Fulfilment, OrderStatus, PackingOrder, ShippingAddress } from '../../../shared/types.js';
import { db, withTransaction } from '../../db/pool.js';
import { parseBody } from '../../http/body.js';
import type { ApiResponse, RequestContext } from '../../http/context.js';
import { errors } from '../../http/errors.js';
import { loadOrder } from '../../repo/orders.js';
import { requireRole } from '../sessions.js';

const PACKERS = ['maker', 'packing'] as const;

type PackingRow = {
  number: string;
  ship_on: string;
  shipping: ShippingAddress;
  fulfilment: Fulfilment;
  version: number;
};

async function packingOrderOf(number: string): Promise<PackingOrder | null> {
  const record = await loadOrder(db, number);
  if (!record) return null;
  return toPackingOrder(
    {
      number: record.row.number,
      ship_on: record.row.ship_on,
      shipping: record.row.shipping,
      fulfilment: record.row.fulfilment,
      version: record.row.version,
    },
    record.lines
      .filter((line) => !line.refunded)
      .map((line) => ({ batch: line.batch_code, scent: line.scent, bar: line.bar })),
  );
}

function toPackingOrder(
  row: PackingRow,
  bars: { batch: string; scent: string; bar: number }[],
): PackingOrder {
  return {
    number: row.number,
    ship_on: row.ship_on,
    name: row.shipping.name,
    address: {
      line1: row.shipping.line1,
      city: row.shipping.city,
      province: row.shipping.province,
      postal_code: row.shipping.postal_code,
    },
    bars,
    fulfilment: row.fulfilment,
    version: row.version,
  };
}

export async function getPacking(ctx: RequestContext): Promise<ApiResponse> {
  requireRole(ctx, PACKERS);
  const today = torontoDate(new Date());
  const settings = await db.query<{ packing_cutoff_local: string }>(
    'SELECT packing_cutoff_local FROM settings WHERE id = 1',
  );
  const orders = await db.query<PackingRow>(
    `SELECT number, ship_on, shipping, fulfilment, version FROM orders
      WHERE fulfilment = 'to_pack' AND status <> 'refunded' AND ship_on <= $1
      ORDER BY ship_on, number`,
    [today],
  );
  const numbers = orders.rows.map((row) => row.number);
  const lines =
    numbers.length === 0
      ? { rows: [] as { order_number: string; batch_code: string; scent: string; bar: number }[] }
      : await db.query<{ order_number: string; batch_code: string; scent: string; bar: number }>(
          `SELECT order_number, batch_code, scent, bar FROM order_lines
            WHERE order_number = ANY($1) AND refunded = false
            ORDER BY order_number, batch_code, bar`,
          [numbers],
        );
  return {
    status: 200,
    body: {
      date: today,
      cutoff_local: settings.rows[0]?.packing_cutoff_local ?? '14:00',
      orders: orders.rows.map((row) =>
        toPackingOrder(
          row,
          lines.rows
            .filter((line) => line.order_number === row.number)
            .map((line) => ({ batch: line.batch_code, scent: line.scent, bar: line.bar })),
        ),
      ),
    },
  };
}

export async function shipOrder(ctx: RequestContext): Promise<ApiResponse> {
  const number = ctx.params['number'] ?? '';
  const existing = await loadOrder(db, number);
  if (!existing) throw errors.notFound();
  requireRole(ctx, PACKERS);
  const parsed = parseBody(ctx.body, {});
  if (!parsed.ok) throw errors.invalid(parsed.fields);
  await withTransaction(async (client) => {
    const locked = await client.query<{ fulfilment: Fulfilment; status: OrderStatus }>(
      'SELECT fulfilment, status FROM orders WHERE number = $1 FOR UPDATE',
      [number],
    );
    const row = locked.rows[0];
    if (!row) throw errors.notFound();
    if (row.fulfilment === 'shipped') {
      throw errors.conflict('already_shipped', STUDIO.alreadyShipped(number));
    }
    if (row.status === 'refunded') {
      throw errors.conflict('order_refunded', STUDIO.orderRefunded(number));
    }
    await client.query(
      `UPDATE orders SET fulfilment = 'shipped', version = version + 1 WHERE number = $1`,
      [number],
    );
  });
  const order = await packingOrderOf(number);
  if (!order) throw errors.notFound();
  return { status: 200, body: { order } };
}
