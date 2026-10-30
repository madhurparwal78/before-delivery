// Reconciliation compares every Kill Bill transaction on kerf- accounts with the app's payment records.
// A mismatch is identified by its type and transaction, so a later run never reopens or duplicates it.
import { db, transaction } from "../db/index.ts";
import { ApiError, FieldErrors, notFound, ok, route } from "../http.ts";
import * as killbill from "../services/killbill.ts";
import { audit } from "./audit.ts";
import { newId } from "./ids.ts";
import { isoOrNull, isoUtc } from "./time.ts";
import { asObject } from "./validate.ts";

type MismatchType = "unknown_in_app" | "missing_in_killbill" | "amount_mismatch" | "status_mismatch";
type MismatchRow = {
  id: string; run_id: string; type: MismatchType; order_ref: string | null; killbill_transaction_id: string | null; transaction_type: string;
  app_amount_cents: number | null; killbill_amount_cents: number | null; status: "open" | "resolved"; note: string | null;
  resolved_by: string | null; resolved_at: Date | null;
};
type Found = Omit<MismatchRow, "id" | "run_id" | "status" | "note" | "resolved_by" | "resolved_at">;

function mismatchView(m: MismatchRow) {
  return { id: m.id, run_id: m.run_id, type: m.type, order_ref: m.order_ref, killbill_transaction_id: m.killbill_transaction_id,
    transaction_type: m.transaction_type, app_amount_cents: m.app_amount_cents, killbill_amount_cents: m.killbill_amount_cents,
    status: m.status, note: m.note, resolved_by: m.resolved_by, resolved_at: isoOrNull(m.resolved_at) };
}

async function compare(): Promise<{ checked: number; found: Found[] }> {
  const payments = await killbill.kerfPayments();
  const records = await db.all<{ kb_transaction_id: string; transaction_type: string; amount_cents: number; status: string; order_ref: string | null }>(
    "SELECT kb_transaction_id, transaction_type, amount_cents, status, order_ref FROM payment_records");
  const refs = new Set((await db.all<{ ref: string }>("SELECT ref FROM orders")).map((o) => o.ref));
  const byId = new Map(records.map((r) => [r.kb_transaction_id, r]));
  const seen = new Set<string>();
  const found: Found[] = [];
  let checked = 0;
  for (const payment of payments) {
    for (const tx of payment.transactions) {
      checked++;
      seen.add(tx.transactionId);
      const record = byId.get(tx.transactionId);
      const kbCents = killbill.kbCents(tx.amount);
      const base = { killbill_transaction_id: tx.transactionId, transaction_type: tx.transactionType, killbill_amount_cents: kbCents,
        order_ref: refs.has(payment.paymentExternalKey) ? payment.paymentExternalKey : null };
      if (!record) {
        if (tx.status === "SUCCESS") found.push({ ...base, type: "unknown_in_app", app_amount_cents: null });
      } else if (record.amount_cents !== kbCents) found.push({ ...base, type: "amount_mismatch", app_amount_cents: record.amount_cents });
      else if (record.status !== tx.status) found.push({ ...base, type: "status_mismatch", app_amount_cents: record.amount_cents });
    }
  }
  for (const record of records) {
    if (!seen.has(record.kb_transaction_id)) {
      found.push({ type: "missing_in_killbill", killbill_transaction_id: record.kb_transaction_id, transaction_type: record.transaction_type,
        killbill_amount_cents: null, app_amount_cents: record.amount_cents, order_ref: record.order_ref });
    }
  }
  return { checked, found };
}

async function runView(runId: string) {
  const run = await db.one<{ id: string; started_at: Date; finished_at: Date; checked_transactions: number }>(
    "SELECT id, started_at, finished_at, checked_transactions FROM reconciliation_runs WHERE id = $1", [runId]);
  if (!run) throw notFound();
  const mismatches = await db.all<MismatchRow>(
    "SELECT m.* FROM mismatches m JOIN run_mismatches r ON r.mismatch_id = m.id WHERE r.run_id = $1 ORDER BY m.found_at, m.id", [runId]);
  return { id: run.id, started_at: isoUtc(run.started_at), finished_at: isoUtc(run.finished_at), checked_transactions: run.checked_transactions,
    mismatches: mismatches.map(mismatchView) };
}

route("POST", "/api/finance/reconciliation-runs", ["finance"], async (ctx) => {
  const started = new Date();
  const { checked, found } = await compare();
  const id = newId();
  await transaction(async (tx) => {
    await tx.query("INSERT INTO reconciliation_runs (id, started_at, finished_at, checked_transactions, actor) VALUES ($1,$2,$3,$4,$5)",
      [id, started, new Date(), checked, ctx.user.email]);
    for (const m of found) {
      const identity = `${m.type}:${m.killbill_transaction_id}`;
      const row = await tx.one<{ id: string }>(
        `INSERT INTO mismatches (id, run_id, type, identity, order_ref, killbill_transaction_id, transaction_type, app_amount_cents, killbill_amount_cents, status, found_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10) ON CONFLICT (identity) DO UPDATE SET identity = EXCLUDED.identity RETURNING id`,
        [newId(), id, m.type, identity, m.order_ref, m.killbill_transaction_id, m.transaction_type, m.app_amount_cents, m.killbill_amount_cents, new Date()]);
      await tx.query("INSERT INTO run_mismatches (run_id, mismatch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, row!.id]);
    }
    await audit(tx, ctx.user, "reconciliation.run", { type: "reconciliation_run", id }, { checked_transactions: checked, mismatches: found.length });
  });
  return ok(await runView(id), 201);
});

route("GET", "/api/finance/reconciliation-runs/:id", ["finance"], async (ctx) => ok(await runView(ctx.params.id!)));

route("GET", "/api/finance/mismatches", ["finance"], async (ctx) => {
  const rows = await db.all<MismatchRow>("SELECT * FROM mismatches WHERE ($1::text IS NULL OR status = $1) ORDER BY found_at DESC, id", [ctx.query.get("status")]);
  return ok({ mismatches: rows.map(mismatchView) });
});

route("POST", "/api/finance/mismatches/:id/resolve", ["finance"], async (ctx) => {
  const note = typeof asObject(ctx.body).note === "string" ? (asObject(ctx.body).note as string).trim().slice(0, 2000) : "";
  const row = await transaction(async (tx) => {
    const m = await tx.one<MismatchRow>("SELECT * FROM mismatches WHERE id = $1 FOR UPDATE", [ctx.params.id!]);
    if (!m) throw notFound();
    if (m.status === "resolved") throw new ApiError(409, "already_resolved");
    if (!note) throw new FieldErrors({ note: "required" });
    const resolved = (await tx.one<MismatchRow>(
      "UPDATE mismatches SET status = 'resolved', note = $2, resolved_by = $3, resolved_at = $4 WHERE id = $1 RETURNING *",
      [m.id, note, ctx.user.email, new Date()]))!;
    await audit(tx, ctx.user, "mismatch.resolved", { type: "mismatch", id: m.id }, { note, type: m.type, killbill_transaction_id: m.killbill_transaction_id });
    return resolved;
  });
  return ok(mismatchView(row));
});
