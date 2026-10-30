
import type { Row } from "../db.js";
import { query } from "../db.js";
import { localIso, utcIso } from "../../shared/time.js";
import { effectiveStatus, seatsRemaining, type Queriable, type SessionRow } from "./seats.js";


const dbQueriable: Queriable = { query: (sql: string, a: unknown[]) => query(sql, a) };

export async function sessionJson(s: SessionRow, opts: { full: boolean; seats?: boolean }): Promise<Record<string, unknown>> {
  const now = new Date();
  const status = effectiveStatus(s.status, s.publish_at, now);
  const seats = opts.seats && s.admission === "seat" && s.capacity !== null
    ? await seatsRemaining(dbQueriable, s.id)
    : null;
  const out: Record<string, unknown> = {
    id: s.id,
    title: s.title,
    description: s.description,
    discipline: s.discipline,
    venue_id: s.venue_id,
    admission: s.admission,
    capacity: s.capacity,
    seats_remaining: seats,
    price_full_cents: s.price_full_cents,
    price_reduced_cents: s.price_reduced_cents,
    starts_at: utcIso(s.starts_at),
    ends_at: utcIso(s.ends_at),
    starts_local: localIso(s.starts_at),
    ends_local: localIso(s.ends_at),
    festival_day: s.festival_day,
    status,
  };
  if (opts.full) {
    out.publish_at = s.publish_at ? utcIso(s.publish_at) : null;
    out.version = s.version;
  }
  return out;
}

export async function lineJson(row: Row): Promise<Record<string, unknown>> {
  const pass = row.pass_code
    ? { code: String(row.pass_code), status: String(row.pass_status) }
    : null;
  return {
    id: Number(row.id),
    position: Number(row.position),
    kind: String(row.kind),
    session_id: row.session_id === null || row.session_id === undefined ? null : String(row.session_id),
    festival_day: row.festival_day === null || row.festival_day === undefined ? null : String(row.festival_day),
    title: String(row.title),
    holder_name: String(row.holder_name),
    state: String(row.state),
    list_cents: Number(row.list_cents),
    group_discount_cents: Number(row.group_discount_cents),
    voucher_cents: Number(row.voucher_cents),
    charged_cents: Number(row.charged_cents),
    pass,
  };
}

export interface LineView extends Row {
  id: number;
  position: number;
  kind: string;
  session_id: string | null;
  festival_day: string | null;
  title: string;
  holder_name: string;
  state: string;
  list_cents: number;
  group_discount_cents: number;
  voucher_cents: number;
  charged_cents: number;
  pass_code: string | null;
  pass_status: string | null;
}

export async function orderLines(orderId: string): Promise<LineView[]> {
  const res = await query(
    `select l.*, p.code as pass_code, p.status as pass_status
     from lines l left join passes p on p.line_id = l.id
     where l.order_id = $1 order by l.position, l.id`,
    [orderId],
  );
  return res.rows as unknown as LineView[];
}

// Order status is derived from its lines:
// proof_pending if any line is proof_pending; otherwise voided if every line is
// voided or expired; otherwise refunded if every remaining line is refunded;
// otherwise refunded_partial if any line is refunded; otherwise confirmed.
export function deriveOrderStatus(lines: Array<{ state: string }>): string {
  if (lines.length === 0) return "confirmed";
  if (lines.some((l) => l.state === "proof_pending")) return "proof_pending";
  if (lines.every((l) => l.state === "voided" || l.state === "expired")) return "voided";
  const live = lines.filter((l) => l.state !== "voided" && l.state !== "expired");
  if (live.length > 0 && live.every((l) => l.state === "refunded")) return "refunded";
  if (lines.some((l) => l.state === "refunded")) return "refunded_partial";
  return "confirmed";
}

export async function refreshOrderStatusTx(client: Queriable, orderId: string): Promise<string> {
  const res = await client.query("select state from lines where order_id = $1", [orderId]);
  const lines = res.rows.map((l) => ({ state: String(l.state) }));
  const status = deriveOrderStatus(lines);
  await client.query("update orders set status = $2 where id = $1", [orderId, status]);
  return status;
}

export async function orderJson(order: Row): Promise<Record<string, unknown>> {
  const orderId = String(order.id);
  const lines = await orderLines(orderId);
  const refunds = await query("select * from refunds where order_id = $1 order by created_at", [orderId]);
  return {
    id: orderId,
    ref: orderId,
    buyer_name: String(order.buyer_name),
    organisation_id: order.organisation_id === null || order.organisation_id === undefined ? null : String(order.organisation_id),
    rate: String(order.rate),
    status: String(order.status),
    subtotal_cents: Number(order.subtotal_cents),
    group_discount_cents: Number(order.group_discount_cents),
    voucher_code: order.voucher_code === null || order.voucher_code === undefined ? null : String(order.voucher_code),
    voucher_cents: Number(order.voucher_cents),
    total_cents: Number(order.total_cents),
    proof_deadline: order.proof_deadline ? utcIso(new Date(String(order.proof_deadline))) : null,
    confirmation_mail: String(order.confirmation_mail),
    invoice_id: order.invoice_id === null || order.invoice_id === undefined ? null : String(order.invoice_id),
    created_at: utcIso(new Date(String(order.created_at))),
    lines: await Promise.all(lines.map((l) => lineJson(l as unknown as Row))),
    refunds: refunds.rows.map((r) => ({
      id: String(r.id),
      order_id: orderId,
      line_ids: r.line_ids,
      card_cents: Number(r.card_cents),
      voucher_cents: Number(r.voucher_cents),
      credit_note_id: r.credit_note_id === null || r.credit_note_id === undefined ? null : String(r.credit_note_id),
      status: String(r.status),
      reason: String(r.reason),
      created_at: utcIso(new Date(String(r.created_at))),
    })),
  };
}

export async function invoiceJson(row: Row): Promise<Record<string, unknown>> {
  const invoiceId = String(row.id);
  const lines = await query(
    "select line_id, description, amount_cents from invoice_lines where invoice_id = $1 order by line_id",
    [invoiceId],
  );
  const notes = await query("select id from credit_notes where invoice_id = $1 order by issued_at", [invoiceId]);
  return {
    id: invoiceId,
    number: String(row.number),
    organisation_id: String(row.organisation_id),
    order_id: String(row.order_id),
    status: String(row.status),
    amount_cents: Number(row.amount_cents),
    credited_cents: Number(row.credited_cents),
    paid_cents: Number(row.paid_cents),
    balance_cents: Number(row.balance_cents),
    issued_at: utcIso(new Date(String(row.issued_at))),
    due_at: utcIso(new Date(String(row.due_at))),
    retries_used: Number(row.retries_used),
    next_retry_at: row.next_retry_at ? utcIso(new Date(String(row.next_retry_at))) : null,
    credit_note_ids: notes.rows.map((n) => String(n.id)),
    lines: lines.rows.map((l) => ({
      line_id: Number(l.line_id),
      description: String(l.description),
      amount_cents: Number(l.amount_cents),
    })),
  };
}

export async function creditNoteJson(row: Row): Promise<Record<string, unknown>> {
  const noteId = String(row.id);
  const lines = await query(
    "select line_id, description, amount_cents from invoice_lines where invoice_id = $1 order by line_id",
    [noteId],
  );
  return {
    id: noteId,
    number: String(row.number),
    invoice_id: String(row.invoice_id),
    amount_cents: Number(row.amount_cents),
    issued_at: utcIso(new Date(String(row.issued_at))),
    lines: lines.rows.map((l) => ({
      line_id: Number(l.line_id),
      description: String(l.description),
      amount_cents: Number(l.amount_cents),
    })),
  };
}

export async function entryJson(row: Row): Promise<Record<string, unknown>> {
  const entryId = String(row.id);
  const images = await query("select * from entry_images where entry_id = $1 order by created_at", [entryId]);
  const artist = await query("select name from users where id = $1", [Number(row.artist_id)]);
  const published = effectiveStatus(String(row.status), row.publish_at ? new Date(String(row.publish_at)) : null, new Date()) === "published";
  return {
    id: entryId,
    artist_id: Number(row.artist_id),
    artist_name: String(artist.rows[0]?.name ?? ""),
    title: String(row.title),
    statement: String(row.statement),
    discipline: String(row.discipline),
    medium: String(row.medium),
    year: String(row.year),
    status: String(row.status),
    publish_at: row.publish_at ? utcIso(new Date(String(row.publish_at))) : null,
    images: images.rows.map((i) => ({
      id: String(i.id),
      width: Number(i.width),
      height: Number(i.height),
      display_url: published ? `/api/media/artworks/${String(i.id)}` : null,
    })),
  };
}

export function proofJson(row: Row): Record<string, unknown> {
  return {
    id: String(row.id),
    order_id: String(row.order_id),
    order_ref: String(row.order_id),
    kind: String(row.kind),
    status: String(row.status),
    uploaded_at: utcIso(new Date(String(row.uploaded_at))),
    deadline: utcIso(new Date(String(row.deadline))),
    content_type: String(row.content_type),
    size_bytes: Number(row.size_bytes),
  };
}

export function mismatchJson(row: Row): Record<string, unknown> {
  return {
    id: String(row.id),
    run_id: String(row.run_id),
    type: String(row.type),
    order_ref: row.order_ref === null || row.order_ref === undefined ? null : String(row.order_ref),
    killbill_transaction_id: row.killbill_transaction_id === null || row.killbill_transaction_id === undefined ? null : String(row.killbill_transaction_id),
    transaction_type: row.transaction_type === null || row.transaction_type === undefined ? null : String(row.transaction_type),
    app_amount_cents: row.app_amount_cents === null || row.app_amount_cents === undefined ? null : Number(row.app_amount_cents),
    killbill_amount_cents: row.killbill_amount_cents === null || row.killbill_amount_cents === undefined ? null : Number(row.killbill_amount_cents),
    status: String(row.status),
    note: row.note === null || row.note === undefined ? null : String(row.note),
    resolved_by: row.resolved_by === null || row.resolved_by === undefined ? null : String(row.resolved_by),
    resolved_at: row.resolved_at ? utcIso(new Date(String(row.resolved_at))) : null,
  };
}

export function auditJson(row: Row): Record<string, unknown> {
  return {
    id: Number(row.id),
    at: utcIso(new Date(String(row.at))),
    actor: String(row.actor),
    actor_role: String(row.actor_role),
    action: String(row.action),
    target_type: String(row.target_type),
    target_id: String(row.target_id),
    detail: row.detail === null || row.detail === undefined ? null : String(row.detail),
  };
}
