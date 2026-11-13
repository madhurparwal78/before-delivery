import type { Order, OrderState } from "../../shared/types.js";
import type { Transaction } from "../db.js";
import { formatCents } from "../domain/money.js";

export interface OrderRow {
  id: string;
  grant_id: string;
  holder_id: string;
  options: number;
  strike: string;
  cost_cents: number;
  idempotency_key: string;
  state: OrderState;
  placed_at: Date;
  issued_at: Date | null;
  payment_id: string | null;
  payment_status: string | null;
  payment_amount_cents: number | null;
  payment_currency: string | null;
  payment_reference: string | null;
  payment_confirmed_at: Date | null;
  notice_document_id: string | null;
  response_status: number | null;
  response_body: unknown;
}

export const ORDER_COLUMNS = `id, grant_id, holder_id, options, strike::text as strike, cost_cents,
  idempotency_key, state, placed_at, issued_at, payment_id, payment_status, payment_amount_cents,
  payment_currency, payment_reference, payment_confirmed_at, notice_document_id,
  response_status, response_body`;

export function buildOrder(row: OrderRow, noticeStatus: "pending" | "sealed" | null): Order {
  return {
    id: row.id,
    grant_id: row.grant_id,
    holder_id: row.holder_id,
    options: row.options,
    strike: row.strike,
    cost: formatCents(BigInt(row.cost_cents)),
    idempotency_key: row.idempotency_key,
    state: row.state,
    placed_at: row.placed_at.toISOString(),
    issued_at: row.issued_at === null ? null : row.issued_at.toISOString(),
    payment:
      row.payment_id === null
        ? null
        : {
            id: row.payment_id,
            status: row.payment_status ?? "pending",
            amount_cents: row.payment_amount_cents ?? 0,
            currency: row.payment_currency ?? "USD",
            reference: row.payment_reference ?? row.id,
            confirmed_at: row.payment_confirmed_at === null ? null : row.payment_confirmed_at.toISOString(),
          },
    notice:
      row.notice_document_id === null || noticeStatus === null
        ? null
        : { document_id: row.notice_document_id, status: noticeStatus },
  };
}

export async function loadOrder(tx: Transaction, id: string): Promise<Order | null> {
  const row = await tx.queryOne<OrderRow>(`select ${ORDER_COLUMNS} from exercise_orders where id = $1`, [id]);
  if (row === null) return null;
  return buildOrder(row, await noticeStatusFor(tx, row));
}

export async function noticeStatusFor(tx: Transaction, row: OrderRow): Promise<"pending" | "sealed" | null> {
  if (row.notice_document_id === null) return null;
  const document = await tx.queryOne<{ status: "pending" | "sealed" }>("select status from documents where id = $1", [
    row.notice_document_id,
  ]);
  return document === null ? null : document.status;
}

export async function loadOrderRow(tx: Transaction, id: string): Promise<OrderRow | null> {
  return tx.queryOne<OrderRow>(`select ${ORDER_COLUMNS} from exercise_orders where id = $1`, [id]);
}
