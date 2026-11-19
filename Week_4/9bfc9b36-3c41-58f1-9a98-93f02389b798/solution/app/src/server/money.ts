/** The sail account in exact pence, and the payments and credit notes that settle it. */
import { lockNamed, one, opaqueId, rows, run, transaction, type Queryable } from "./db.js";
import { audit } from "./audit.js";
import { drawingRow, loadFact } from "./drawings.js";
import { refuse, FieldErrors } from "./errors.js";
import { instant, now, wholeSecond } from "./time.js";
import * as check from "./validate.js";
import { FIELD } from "../shared/copy.js";
import { roundDiv } from "../shared/units.js";
import type { AccountRow } from "./accounts.js";
import { projectSailAccount } from "./projection.js";
import type { Role, SailAccount, SailAccountEntry } from "../shared/types.js";

const TAX_PERCENT = 20;
const DEPOSIT_PERCENT = 40;
const MM2_PER_M2 = 1_000_000;

interface AccountFigures {
  charge: number;
  tax: number;
  total: number;
  deposit: number;
}

function accountFigures(areaMm2: number, ratePencePerM2: number): AccountFigures {
  const charge = roundDiv(areaMm2 * ratePencePerM2, MM2_PER_M2);
  const tax = roundDiv(charge * TAX_PERCENT, 100);
  const total = charge + tax;
  return { charge, tax, total, deposit: roundDiv(total * DEPOSIT_PERCENT, 100) };
}

/** Whether a drawing has a sail account: Cut, Pending store or Issued. */
export async function requireAccountable(db: Queryable, code: string): Promise<void> {
  const facts = (await loadFact(db, code, now()))!;
  if (!["cut", "pending_store", "issued"].includes(facts.derived.status)) throw refuse("wrong_state");
}

export async function sailAccount(db: Queryable, code: string, role: Role): Promise<SailAccount> {
  const drawing = (await one<{ area_mm2: number; cloth_code: string; rate: number }>(
    db,
    "SELECT d.area_mm2, d.cloth_code, c.rate_pence_per_m2 AS rate FROM drawing d JOIN cloth c ON c.code = d.cloth_code WHERE d.code = $1",
    [code],
  ))!;
  const entries = await rows(db, "SELECT e.*, a.email AS by_email FROM sail_entry e LEFT JOIN account a ON a.id = e.recorded_by WHERE e.drawing_code = $1 ORDER BY e.id DESC", [code]);
  const figures = accountFigures(drawing.area_mm2, drawing.rate);
  const paid = entries.filter((e) => e.kind === "payment").reduce((sum, e) => sum + e.amount_pence, 0);
  const credited = entries.filter((e) => e.kind === "credit_note").reduce((sum, e) => sum + e.amount_pence, 0);
  const balance = figures.total - paid - credited;
  const status = balance === 0 ? "settled" : paid + credited < figures.deposit ? "deposit_due" : "balance_due";
  return projectSailAccount({
    drawing_code: code,
    status,
    cloth_code: drawing.cloth_code,
    rate_pence_per_m2: drawing.rate,
    area_mm2: drawing.area_mm2,
    charge_pence: figures.charge,
    tax_rate_percent: TAX_PERCENT,
    tax_pence: figures.tax,
    total_pence: figures.total,
    deposit_pence: figures.deposit,
    paid_pence: paid,
    credited_pence: credited,
    balance_pence: balance,
    entries: entries.map((entry): SailAccountEntry => {
      const view: SailAccountEntry = {
        id: entry.id,
        kind: entry.kind,
        amount_pence: entry.amount_pence,
        at: instant(entry.at),
        note: entry.kind === "payment" ? entry.note : null,
        reason: entry.kind === "credit_note" ? entry.reason : null,
        recorded_by: entry.by_email,
      };
      return view;
    }),
  }, role);
}

interface Reply {
  status: number;
  body: string;
}

const KEY = /^[\x20-\x7e]{1,100}$/;

function amountOf(body: check.Body): number | null {
  const value = body.amount_pence;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && Number.isSafeInteger(value) ? value : null;
}

export async function recordPayment(actor: AccountRow, code: string, key: string | null, body: check.Body): Promise<Reply> {
  return transaction(async (db) => {
    await drawingRow(db, code, true);
    await requireAccountable(db, code);
    const amount = amountOf(body);
    const note = typeof body.note === "string" ? body.note : "";
    if (key !== null && KEY.test(key)) {
      await lockNamed(db, `payment:${key}`);
      const seen = await one<{ drawing_code: string; amount_pence: number; status: number; body: string }>(db, "SELECT * FROM payment_key WHERE key = $1", [key]);
      if (seen) {
        if (seen.drawing_code !== code || seen.amount_pence !== amount) throw refuse("idempotency_key_reused");
        return { status: seen.status, body: seen.body };
      }
    }
    const account = await sailAccount(db, code, "sailmaker");
    if (amount !== null && amount > account.balance_pence) throw refuse("exceeds_balance");
    const errors = new FieldErrors();
    if (key === null || !KEY.test(key)) errors.add("idempotency-key", FIELD.required);
    if (amount === null) errors.add("amount_pence", FIELD.amount);
    check.text(errors, body, "note", 0, 200);
    errors.throwIfAny();
    const id = await opaqueId(db, "PAY-");
    await run(db, "INSERT INTO sail_entry (id, drawing_code, kind, amount_pence, at, note, recorded_by) VALUES ($1, $2, 'payment', $3, $4, $5, $6)", [
      id,
      code,
      amount,
      wholeSecond(now()),
      note,
      actor.id,
    ]);
    await audit(db, { actor: actor.email, action: "payment.record", target: code, after: String(amount) });
    const reply: Reply = { status: 201, body: JSON.stringify(await sailAccount(db, code, "sailmaker")) };
    await run(db, "INSERT INTO payment_key (key, drawing_code, amount_pence, note, status, body) VALUES ($1, $2, $3, $4, $5, $6)", [key, code, amount, note, reply.status, reply.body]);
    return reply;
  });
}

export async function recordCreditNote(actor: AccountRow, code: string, body: check.Body): Promise<SailAccount> {
  return transaction(async (db) => {
    await drawingRow(db, code, true);
    await requireAccountable(db, code);
    const amount = amountOf(body);
    const account = await sailAccount(db, code, "sailmaker");
    if (amount !== null && amount > account.balance_pence) throw refuse("exceeds_balance");
    const errors = new FieldErrors();
    if (amount === null) errors.add("amount_pence", FIELD.amount);
    const reason = check.reason(errors, body, "reason", FIELD.reason);
    errors.throwIfAny();
    const id = await opaqueId(db, "CN-");
    await run(db, "INSERT INTO sail_entry (id, drawing_code, kind, amount_pence, at, reason, recorded_by) VALUES ($1, $2, 'credit_note', $3, $4, $5, $6)", [
      id,
      code,
      amount,
      wholeSecond(now()),
      reason,
      actor.id,
    ]);
    await audit(db, { actor: actor.email, action: "credit_note.record", target: code, after: String(amount), reason });
    return sailAccount(db, code, "sailmaker");
  });
}
