// Refunds return exactly the affected lines: the card share as one Kill Bill refund (visitor orders) or one
// credit note (group orders), the voucher share back to its voucher. Kill Bill work that must survive an
// outage (refunds, voids, credit-note adjustments) is a payment task the worker completes exactly once.
import type { User } from "../auth.ts";
import { db, transaction, type Db } from "../db/index.ts";
import { ApiError, FieldErrors, notFound, ok, route } from "../http.ts";
import * as killbill from "../services/killbill.ts";
import { audit, type Actor } from "./audit.ts";
import { newId } from "./ids.ts";
import { adjustCreditNote, issueCreditNote } from "./invoices.ts";
import { mails } from "./mails.ts";
import { REFUND_SELECT, linesOf, moveLines, orderViews, refundView, refusedMoves, searchOrders, visibleOrder, type LineRow } from "./orders.ts";
import { queueMail } from "./outbox.ts";
import { settleSession } from "./seats.ts";
import { recordMovement } from "./vouchers.ts";
import { asObject } from "./validate.ts";

type TaskKind = "refund" | "void" | "credit_note";

export async function queueTask(q: Db, kind: TaskKind, subjectId: string): Promise<void> {
  await q.query("INSERT INTO payment_tasks (kind, subject_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (kind, subject_id) DO NOTHING",
    [kind, subjectId, new Date()]);
}

async function runTask(tx: Db, kind: TaskKind, subjectId: string): Promise<void> {
  if (kind === "credit_note") {
    await adjustCreditNote(tx, subjectId);
    await tx.query("UPDATE refunds SET status = 'completed', completed_at = $2 WHERE credit_note_id = $1", [subjectId, new Date()]);
    return;
  }
  if (kind === "void") {
    const order = (await tx.one<{ ref: string; kb_payment_id: string }>("SELECT ref, kb_payment_id FROM orders WHERE id = $1", [subjectId]))!;
    const voided = await killbill.voidPayment(order.kb_payment_id, order.ref);
    await killbill.recordTransaction(tx, order.kb_payment_id, voided, { orderRef: order.ref });
    return;
  }
  const refund = (await tx.one<{ id: string; card_cents: number; ref: string; kb_payment_id: string }>(
    "SELECT r.id, r.card_cents, o.ref, o.kb_payment_id FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.id = $1", [subjectId]))!;
  const tx2 = await killbill.refund(refund.kb_payment_id, refund.id, refund.card_cents);
  await killbill.recordTransaction(tx, refund.kb_payment_id, tx2, { orderRef: refund.ref });
  await tx.query("UPDATE refunds SET status = 'completed', completed_at = $2 WHERE id = $1", [refund.id, new Date()]);
}

/** Runs one pending task under its row lock; false when there is none (or another instance holds it). */
async function runOneTask(only?: { kind: TaskKind; subjectId: string }): Promise<boolean> {
  return transaction(async (tx) => {
    const task = await tx.one<{ id: number; kind: TaskKind; subject_id: string }>(
      `SELECT id, kind, subject_id FROM payment_tasks WHERE done_at IS NULL AND ($1::text IS NULL OR (kind = $1 AND subject_id = $2))
       ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`, [only?.kind ?? null, only?.subjectId ?? null]);
    if (!task) return false;
    await tx.query("UPDATE payment_tasks SET attempts = attempts + 1 WHERE id = $1", [task.id]);
    await runTask(tx, task.kind, task.subject_id);
    await tx.query("UPDATE payment_tasks SET done_at = $2 WHERE id = $1", [task.id, new Date()]);
    return true;
  });
}

export async function paymentTaskSweep(): Promise<void> {
  while (await runOneTask()) { /* keep going while tasks complete */ }
}

/** Tries a task straight away; while Kill Bill is down it stays pending for the worker. */
async function tryNow(kind: TaskKind, subjectId: string): Promise<void> {
  await runOneTask({ kind, subjectId }).catch(() => false);
}

type Affected = { orderId: string; lines: LineRow[] };

/**
 * Refunds the given lines of one order: captured and transferred lines become refunded, proof-pending lines are
 * voided. Records one refund, returns voucher shares, queues the buyer's notice or the group's credit note.
 */
async function refundLines(tx: Db, actor: Actor, affected: Affected, reason: string): Promise<{ refundId: string; tasks: [TaskKind, string][] }> {
  const order = (await tx.one<{ id: string; ref: string; voucher_code: string | null; organisation_id: string | null; kb_payment_id: string | null; buyer_email: string }>(
    "SELECT o.id, o.ref, o.voucher_code, o.organisation_id, o.kb_payment_id, u.email AS buyer_email FROM orders o JOIN users u ON u.id = o.buyer_id WHERE o.id = $1",
    [affected.orderId]))!;
  const tasks: [TaskKind, string][] = [];
  const sold = affected.lines.filter((l) => !refusedMoves([l], "refunded").length);
  const pending = affected.lines.filter((l) => !sold.includes(l));
  if (sold.length) {
    await moveLines(tx, sold.map((l) => l.id), "refunded");
    await tx.query("UPDATE passes SET status = 'refunded' WHERE line_id = ANY($1) AND status = 'valid'", [sold.map((l) => l.id)]);
  }
  if (pending.length) await moveLines(tx, pending.map((l) => l.id), "voided");
  const card = sold.reduce((s, l) => s + l.charged_cents, 0);
  const voucher = affected.lines.reduce((s, l) => s + l.voucher_cents, 0);
  if (voucher > 0) await recordMovement(tx, "return", order.voucher_code!, voucher, actor === "system" ? "system" : actor.email, order.ref);
  const id = newId();
  let creditNoteId: string | null = null;
  if (order.organisation_id !== null) {
    creditNoteId = await issueCreditNote(tx, order.id, sold);
    tasks.push(["credit_note", creditNoteId]);
  } else {
    await queueMail(tx, mails.refundNotice(order.buyer_email, order.ref, affected.lines, card, voucher, card === 0 && pending.length > 0));
    if (card > 0) tasks.push(["refund", id]);
  }
  const status = tasks.length ? "pending" : "completed";
  await tx.query(`INSERT INTO refunds (id, order_id, line_ids, card_cents, voucher_cents, credit_note_id, status, reason, created_at, completed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, order.id, affected.lines.map((l) => l.id), card, voucher, creditNoteId, status, reason, new Date(), status === "completed" ? new Date() : null]);
  // If every pending line of the order is now voided, the authorisation is voided at that point.
  const stillPending = await tx.one("SELECT 1 FROM lines WHERE order_id = $1 AND state = 'proof_pending'", [order.id]);
  if (pending.length && !stillPending && order.kb_payment_id) tasks.push(["void", order.id]);
  for (const [kind, subject] of tasks) await queueTask(tx, kind, subject);
  return { refundId: id, tasks };
}

/** A curator's cancellation refunds every line for the session on every order. Returns the orders refunded. */
export async function refundCancelledSession(tx: Db, actor: User, sessionId: string): Promise<{ count: number; tasks: [TaskKind, string][] }> {
  const lines = await tx.all<{ id: string; order_id: string }>(
    "SELECT id, order_id FROM lines WHERE session_id = $1 AND state IN ('captured', 'transferred', 'proof_pending') ORDER BY order_id, position", [sessionId]);
  const orderIds = [...new Set(lines.map((l) => l.order_id))];
  const tasks: [TaskKind, string][] = [];
  for (const orderId of orderIds) {
    await tx.query("SELECT id FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    const own = (await linesOf(tx, [orderId])).filter((l) => lines.some((x) => x.id === l.id));
    tasks.push(...(await refundLines(tx, actor, { orderId, lines: own }, "Session cancelled")).tasks);
  }
  return { count: orderIds.length, tasks };
}

/** Starts the Kill Bill side of refunds right after their commit. */
export async function startTasks(tasks: readonly [TaskKind, string][]): Promise<void> {
  for (const [kind, subject] of tasks) await tryNow(kind, subject);
}

route("POST", "/api/finance/orders/:id/refunds", ["finance"], async (ctx) => {
  const body = asObject(ctx.body);
  const result = await transaction(async (tx) => {
    const order = await visibleOrder(tx, ctx.user, ctx.params.id!, true);
    const lines = await linesOf(tx, [order.id]);
    const ids = Array.isArray(body.line_ids) ? [...new Set(body.line_ids.filter((x): x is string => typeof x === "string"))] : [];
    const chosen = ids.map((id) => lines.find((l) => l.id === id));
    if (chosen.some((l) => !l)) throw notFound();
    const refusable = refusedMoves(chosen as LineRow[], "refunded");
    if (refusable.length) throw new ApiError(409, "line_not_refundable", { line_ids: refusable.map((l) => l.id) });
    const errors: Record<string, string> = {};
    if (!ids.length) errors.line_ids = "empty";
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!reason) errors.reason = "required";
    if (Object.keys(errors).length) throw new FieldErrors(errors);
    const done = await refundLines(tx, ctx.user, { orderId: order.id, lines: chosen as LineRow[] }, reason);
    for (const sessionId of new Set((chosen as LineRow[]).map((l) => l.session_id).filter((s): s is string => !!s))) {
      await settleSession(tx, sessionId, new Date());
    }
    await audit(tx, ctx.user, "refund.started", { type: "refund", id: done.refundId }, { order_ref: order.ref, line_ids: ids, reason });
    return done;
  });
  await startTasks(result.tasks);
  const refund = await db.one<Parameters<typeof refundView>[0]>(`${REFUND_SELECT} WHERE id = $1`, [result.refundId]);
  return ok(refundView(refund!), 201);
}, { idempotent: true });

route("GET", "/api/finance/refunds", ["finance"], async (ctx) => {
  const status = ctx.query.get("status");
  const rows = await db.all<Parameters<typeof refundView>[0]>(`${REFUND_SELECT} WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 500`, [status]);
  return ok({ refunds: rows.map(refundView) });
});

route("GET", "/api/finance/orders", ["finance"], async (ctx) => {
  return ok({ orders: await orderViews(db, await searchOrders(db, (ctx.query.get("q") ?? "").trim())) });
});
