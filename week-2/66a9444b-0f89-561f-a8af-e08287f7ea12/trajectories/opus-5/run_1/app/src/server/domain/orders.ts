import { many, one, type Queryable } from '../db/pool.js';
import { newId, newPassCode } from '../lib/codes.js';
import { toUtcIso } from '../lib/time.js';
import { objectKeys, putObject } from '../services/storage.js';
import { renderPassPdf } from '../services/pdf.js';
import { formatDayLabel, formatSessionWhen } from './format.js';
import { loadEdition } from './programme.js';

export type LineState =
  | 'held'
  | 'authorised'
  | 'proof_pending'
  | 'captured'
  | 'transferred'
  | 'refunded'
  | 'voided'
  | 'expired';

export type OrderStatus =
  | 'proof_pending'
  | 'voided'
  | 'refunded'
  | 'refunded_partial'
  | 'confirmed';

export interface OrderRow {
  id: string;
  ref: string;
  user_id: string;
  buyer_name: string;
  buyer_email: string;
  organisation_id: string | null;
  rate: 'full' | 'reduced';
  subtotal_cents: number;
  group_discount_cents: number;
  voucher_code: string | null;
  voucher_cents: number;
  total_cents: number;
  proof_deadline: Date | null;
  killbill_account_id: string | null;
  killbill_payment_id: string | null;
  created_at: Date;
}

export interface LineRow {
  id: string;
  order_id: string;
  position: number;
  kind: 'seat' | 'full_festival' | 'day';
  session_id: string | null;
  festival_day: string | null;
  title: string;
  holder_name: string;
  state: LineState;
  list_cents: number;
  group_discount_cents: number;
  voucher_cents: number;
  charged_cents: number;
}

const ORDER_COLUMNS = `
  o.id, o.ref, o.user_id, u.name AS buyer_name, u.email AS buyer_email, o.organisation_id, o.rate,
  o.subtotal_cents, o.group_discount_cents, o.voucher_code, o.voucher_cents, o.total_cents,
  o.proof_deadline, o.killbill_account_id, o.killbill_payment_id, o.created_at`;

export async function loadOrder(db: Queryable, id: string): Promise<OrderRow | null> {
  return one<OrderRow>(
    db,
    `SELECT ${ORDER_COLUMNS} FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1`,
    [id],
  );
}

export async function orderLines(db: Queryable, orderId: string): Promise<LineRow[]> {
  return many<LineRow>(
    db,
    `SELECT id, order_id, position, kind, session_id, festival_day::text AS festival_day, title,
            holder_name, state, list_cents, group_discount_cents, voucher_cents, charged_cents
     FROM order_lines WHERE order_id = $1 ORDER BY position`,
    [orderId],
  );
}

export async function loadLine(db: Queryable, lineId: string): Promise<LineRow | null> {
  return one<LineRow>(
    db,
    `SELECT id, order_id, position, kind, session_id, festival_day::text AS festival_day, title,
            holder_name, state, list_cents, group_discount_cents, voucher_cents, charged_cents
     FROM order_lines WHERE id = $1`,
    [lineId],
  );
}

/** Order status is derived from its lines. */
export function deriveOrderStatus(lines: readonly LineRow[]): OrderStatus {
  if (lines.some((line) => line.state === 'proof_pending')) return 'proof_pending';
  if (lines.every((line) => line.state === 'voided' || line.state === 'expired')) return 'voided';
  const remaining = lines.filter((line) => line.state !== 'voided' && line.state !== 'expired');
  if (remaining.length > 0 && remaining.every((line) => line.state === 'refunded')) {
    return 'refunded';
  }
  if (lines.some((line) => line.state === 'refunded')) return 'refunded_partial';
  return 'confirmed';
}

export interface SerialisedPass {
  code: string;
  status: string;
}

export interface SerialisedLine {
  id: string;
  position: number;
  kind: LineRow['kind'];
  session_id: string | null;
  festival_day: string | null;
  title: string;
  holder_name: string;
  state: LineState;
  list_cents: number;
  group_discount_cents: number;
  voucher_cents: number;
  charged_cents: number;
  pass: SerialisedPass | null;
}

export interface SerialisedRefund {
  id: string;
  order_id: string;
  line_ids: string[];
  card_cents: number;
  voucher_cents: number;
  credit_note_id: string | null;
  status: 'pending' | 'completed';
  reason: string;
  created_at: string;
}

export interface SerialisedOrder {
  id: string;
  ref: string;
  buyer_name: string;
  organisation_id: string | null;
  rate: 'full' | 'reduced';
  status: OrderStatus;
  subtotal_cents: number;
  group_discount_cents: number;
  voucher_code: string | null;
  voucher_cents: number;
  total_cents: number;
  proof_deadline: string | null;
  confirmation_mail: 'sent' | 'pending';
  invoice_id: string | null;
  created_at: string;
  lines: SerialisedLine[];
  refunds: SerialisedRefund[];
}

export async function currentPass(
  db: Queryable,
  lineId: string,
): Promise<{ code: string; status: string } | null> {
  return one<{ code: string; status: string }>(
    db,
    `SELECT code, status FROM passes WHERE line_id = $1 ORDER BY created_at DESC, code LIMIT 1`,
    [lineId],
  );
}

export async function serialiseOrder(db: Queryable, order: OrderRow): Promise<SerialisedOrder> {
  const lines = await orderLines(db, order.id);
  const serialisedLines: SerialisedLine[] = [];
  for (const line of lines) {
    const pass = await currentPass(db, line.id);
    serialisedLines.push({
      id: line.id,
      position: line.position,
      kind: line.kind,
      session_id: line.session_id,
      festival_day: line.festival_day,
      title: line.title,
      holder_name: line.holder_name,
      state: line.state,
      list_cents: line.list_cents,
      group_discount_cents: line.group_discount_cents,
      voucher_cents: line.voucher_cents,
      charged_cents: line.charged_cents,
      pass,
    });
  }

  const refunds = await many<{
    id: string;
    order_id: string;
    line_ids: string[];
    card_cents: number;
    voucher_cents: number;
    credit_note_id: string | null;
    status: 'pending' | 'completed';
    reason: string;
    created_at: Date;
  }>(
    db,
    `SELECT id, order_id, line_ids, card_cents, voucher_cents, credit_note_id, status, reason,
            created_at
     FROM refunds WHERE order_id = $1 ORDER BY created_at`,
    [order.id],
  );

  const mail = await one<{ status: string }>(
    db,
    `SELECT status FROM outbox WHERE event_key = $1`,
    [`order-confirmation:${order.id}`],
  );

  const invoice = await one<{ id: string }>(db, `SELECT id FROM invoices WHERE order_id = $1`, [
    order.id,
  ]);

  return {
    id: order.id,
    ref: order.ref,
    buyer_name: order.buyer_name,
    organisation_id: order.organisation_id,
    rate: order.rate,
    status: deriveOrderStatus(lines),
    subtotal_cents: order.subtotal_cents,
    group_discount_cents: order.group_discount_cents,
    voucher_code: order.voucher_code,
    voucher_cents: order.voucher_cents,
    total_cents: order.total_cents,
    proof_deadline: order.proof_deadline === null ? null : toUtcIso(order.proof_deadline),
    confirmation_mail: mail?.status === 'sent' ? 'sent' : 'pending',
    invoice_id: invoice?.id ?? null,
    created_at: toUtcIso(order.created_at),
    lines: serialisedLines,
    refunds: refunds.map((refund) => ({
      id: refund.id,
      order_id: refund.order_id,
      line_ids: refund.line_ids,
      card_cents: refund.card_cents,
      voucher_cents: refund.voucher_cents,
      credit_note_id: refund.credit_note_id,
      status: refund.status,
      reason: refund.reason,
      created_at: toUtcIso(refund.created_at),
    })),
  };
}

export interface PassFaceDetails {
  whenText: string;
  venueName: string;
}

/** The face of a pass, with no buyer, price, rate or payment detail on it. */
export async function passFace(db: Queryable, line: LineRow): Promise<PassFaceDetails> {
  if (line.kind === 'seat' && line.session_id !== null) {
    const session = await one<{ starts_at: Date; ends_at: Date; venue_name: string }>(
      db,
      `SELECT s.starts_at, s.ends_at, v.name AS venue_name
       FROM programme_sessions s JOIN venues v ON v.id = s.venue_id WHERE s.id = $1`,
      [line.session_id],
    );
    if (session !== null) {
      return {
        whenText: formatSessionWhen(session.starts_at, session.ends_at),
        venueName: session.venue_name,
      };
    }
  }
  if (line.kind === 'day' && line.festival_day !== null) {
    return {
      whenText: formatDayLabel(line.festival_day),
      venueName: 'Every venue except the Planetarium Dome',
    };
  }
  const edition = await loadEdition(db);
  return {
    whenText: `${formatDayLabel(edition.first_day)} \u2013 ${formatDayLabel(edition.last_day)}`,
    venueName: 'Every venue',
  };
}

export interface IssuedPass {
  code: string;
  objectKey: string;
}

/** Renders and stores the pass PDF, then records it. Storage comes first so nothing is half issued. */
export async function issuePass(
  db: Queryable,
  order: OrderRow,
  line: LineRow,
  holderName: string,
): Promise<IssuedPass> {
  const code = newPassCode();
  const face = await passFace(db, line);
  const pdf = renderPassPdf({
    holderName,
    itemTitle: line.title,
    whenText: face.whenText,
    venueName: face.venueName,
    passCode: code,
  });
  const objectKey = objectKeys.pass(order.ref, code);
  await putObject(objectKey, pdf, 'application/pdf');
  await db.query(
    `INSERT INTO passes (id, code, line_id, holder_name, status, object_key)
     VALUES ($1, $2, $3, $4, 'valid', $5)`,
    [newId(), code, line.id, holderName, objectKey],
  );
  return { code, objectKey };
}

export function passFileName(code: string): string {
  return `${code}.pdf`;
}
