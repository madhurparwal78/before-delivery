// Sign-in, the caller's profile, members and their hours: pack purchases, adjustments, reversals, invoices.

import type { LedgerTransaction, MemberSummary, Role } from "../shared/api.js";
import { CELL_MINUTES } from "../shared/rules.js";
import { chargeAndPayPack, invoiceOwner, memberInvoice, memberInvoices } from "./billing.js";
import { tx, type Db } from "./db.js";
import { insuranceSummary } from "./documents.js";
import { conflict, FieldErrors, forbidden, invalid, notFound } from "./errors.js";
import { cookies, empty, json, type Reply, type Request } from "./http.js";
import { pack } from "./kitchen.js";
import { balance, lockBalance, memberLedger, post, transaction } from "./ledger.js";
import { enqueueInvoiceNotice, kickMail } from "./mail.js";
import { verifyPassword } from "./passwords.js";
import { clearedCookie, createSession, endSession, sessionCookie, userJson, type SessionUser } from "./sessions.js";

const MAX_ADJUST_MINUTES = 6000;
const MAX_REASON = 200;

export async function signIn(req: Request): Promise<Reply> {
  const { email, password } = req.json;
  const errors = new FieldErrors();
  if (typeof email !== "string" || email.trim() === "") errors.add("email", "required");
  if (typeof password !== "string" || password === "") errors.add("password", "required");
  if (typeof email !== "string" || typeof password !== "string" || errors.any()) throw errors.error();
  const outcome = await tx(async (db) => {
    const found = await db.query<{ id: string; role: Role; name: string; email: string; member_id: string | null; business_name: string | null; password_hash: string }>(
      `SELECT u.id, u.role, u.name, u.email, u.member_id, m.business_name, u.password_hash
         FROM users u LEFT JOIN members m ON m.id = u.member_id WHERE lower(u.email) = lower($1)`,
      [email.trim()],
    );
    const row = found.rows[0];
    if (!row || !(await verifyPassword(password, row.password_hash))) return null;
    const user: SessionUser = { id: row.id, role: row.role, name: row.name, email: row.email, memberId: row.member_id, businessName: row.business_name };
    return { user, token: await createSession(db, row.id) };
  });
  if (!outcome) return json(401, { error: "invalid_credentials" });
  return { status: 200, body: { user: userJson(outcome.user) }, headers: { "Set-Cookie": sessionCookie(outcome.token) } };
}

export async function signOut(req: Request): Promise<Reply> {
  const token = cookies(req.headers).passboard_session;
  if (token) await tx((db) => endSession(db, token));
  return { ...empty(204), headers: { "Set-Cookie": clearedCookie() } };
}

export async function me(_req: Request, user: SessionUser): Promise<Reply> {
  const memberId = user.memberId;
  const minutes = user.role === "member" && memberId ? await tx((db) => balance(db, memberId)) : null;
  return json(200, { user: userJson(user), balance_minutes: minutes });
}

export async function renameBusiness(req: Request, user: SessionUser): Promise<Reply> {
  if (user.role !== "member" || !user.memberId) throw forbidden();
  const raw = req.json.business_name;
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name.length < 1 || name.length > 80) throw invalid({ business_name: "length" });
  const memberId = user.memberId;
  await tx((db) => db.query("UPDATE members SET business_name = $2 WHERE id = $1", [memberId, name]));
  return json(200, { member: { id: memberId, business_name: name } });
}

function requireOperator(user: SessionUser): void {
  if (user.role !== "operator") throw forbidden();
}

export async function listMembers(_req: Request, user: SessionUser): Promise<Reply> {
  requireOperator(user);
  const members = await tx(async (db) => {
    const rows = await db.query<{ id: string; business_name: string; contact_email: string }>("SELECT id, business_name, contact_email FROM members ORDER BY business_name, id");
    const result: MemberSummary[] = [];
    for (const m of rows.rows) {
      result.push({
        id: m.id,
        business_name: m.business_name,
        contact_email: m.contact_email,
        balance_minutes: await balance(db, m.id),
        liability_insurance: await insuranceSummary(db, m.id),
      });
    }
    return result;
  });
  return json(200, { members });
}

/** Members read their own ledger; the operator names the member. */
async function ledgerMember(req: Request, user: SessionUser): Promise<string> {
  const requested = req.query.get("member_id");
  if (user.role === "member") {
    if (requested !== null && requested !== user.memberId) throw notFound();
    return user.memberId ?? "";
  }
  if (user.role !== "operator") throw forbidden();
  if (requested === null || requested === "") throw invalid({ member_id: "required" });
  const exists = await tx((db) => db.query("SELECT 1 FROM members WHERE id = $1", [requested]));
  if (exists.rowCount !== 1) throw notFound();
  return requested;
}

export async function readLedger(req: Request, user: SessionUser): Promise<Reply> {
  const memberId = await ledgerMember(req, user);
  return json(200, await tx((db) => memberLedger(db, memberId)));
}

export async function buyPack(req: Request, user: SessionUser): Promise<Reply> {
  const chosen = pack(req.params.pack_id);
  if (!chosen) throw notFound();
  if (user.role !== "member" || !user.memberId) throw forbidden();
  const memberId = user.memberId;
  const invoiceId = await chargeAndPayPack(memberId, chosen.priceCents, chosen.name);
  const outcome = await tx(async (db) => {
    const current = await lockBalance(db, memberId);
    const id = await post(db, { memberId, kind: "pack_purchase", memberMinutes: chosen.minutes }, current);
    await enqueueInvoiceNotice(db, memberId, invoiceId, chosen.priceCents, chosen.name);
    return { transaction: await posted(db, id), balance: current + chosen.minutes };
  });
  kickMail();
  return json(201, { transaction: outcome.transaction, balance_minutes: outcome.balance, invoice_id: invoiceId });
}

/** A transaction this request has just written. */
async function posted(db: Db, id: string): Promise<LedgerTransaction> {
  const written = await transaction(db, id);
  if (!written) throw new Error(`transaction ${id} not readable after write`);
  return written.json;
}

function reasonOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return raw.trim().length >= 1 && raw.length <= MAX_REASON ? raw : null;
}

export async function adjustHours(req: Request, user: SessionUser): Promise<Reply> {
  const memberId = typeof req.json.member_id === "string" ? req.json.member_id : "";
  const outcome = await tx(async (db) => {
    const exists = await db.query("SELECT 1 FROM members WHERE id = $1", [memberId]);
    if (exists.rowCount !== 1 || (user.role !== "operator" && user.memberId !== memberId)) throw notFound();
    requireOperator(user);
    const errors = new FieldErrors();
    const minutes = req.json.minutes;
    const valid = typeof minutes === "number" && Number.isInteger(minutes) && minutes !== 0 && minutes % CELL_MINUTES === 0 && Math.abs(minutes) <= MAX_ADJUST_MINUTES;
    if (!valid) errors.add("minutes", "invalid");
    const reason = reasonOf(req.json.reason);
    if (reason === null) errors.add("reason", "length");
    if (typeof minutes !== "number" || reason === null || errors.any()) throw errors.error();
    const current = await lockBalance(db, memberId);
    const id = await post(db, { memberId, kind: "adjustment", memberMinutes: minutes, reason }, current);
    return { transaction: await posted(db, id), balance: current + minutes };
  });
  return json(201, { transaction: outcome.transaction, balance_minutes: outcome.balance });
}

export async function reverseTransaction(req: Request, user: SessionUser): Promise<Reply> {
  const outcome = await tx(async (db) => {
    await db.query("SELECT id FROM ledger_transactions WHERE id = $1 FOR UPDATE", [req.params.id]);
    const original = await transaction(db, req.params.id);
    if (!original || (user.role !== "operator" && user.memberId !== original.memberId)) throw notFound();
    requireOperator(user);
    const reason = reasonOf(req.json.reason);
    if (reason === null) throw invalid({ reason: "length" });
    const { kind, member_minutes: minutes, reversed_by: reversedBy } = original.json;
    if (kind !== "adjustment" && kind !== "opening") throw conflict("not_reversible");
    if (reversedBy) throw conflict("already_reversed");
    const current = await lockBalance(db, original.memberId);
    const id = await post(
      db,
      { memberId: original.memberId, kind: "reversal", memberMinutes: -minutes, reason, reverses: { id: original.json.id, kitchenAccount: original.kitchenAccount } },
      current,
    );
    return { transaction: await posted(db, id), balance: current - minutes };
  });
  return json(201, { transaction: outcome.transaction, balance_minutes: outcome.balance });
}

/** Members read their own invoices; the operator names the member. */
async function invoiceMember(req: Request, user: SessionUser): Promise<string> {
  const requested = req.query.get("member_id");
  if (user.role === "member") {
    if (requested !== null && requested !== user.memberId) throw notFound();
    return user.memberId ?? "";
  }
  if (user.role !== "operator") throw forbidden();
  if (requested === null || requested === "") throw invalid({ member_id: "required" });
  return requested;
}

export async function listInvoices(req: Request, user: SessionUser): Promise<Reply> {
  const memberId = await invoiceMember(req, user);
  return json(200, { invoices: await tx((db) => memberInvoices(db, memberId)) });
}

export async function getInvoice(req: Request, user: SessionUser): Promise<Reply> {
  if (user.role === "crew_cook") throw forbidden();
  const invoice = await tx(async (db) => {
    const memberId = user.role === "operator" ? await invoiceOwner(db, req.params.id) : user.memberId;
    return memberId ? memberInvoice(db, memberId, req.params.id) : null;
  });
  if (!invoice) throw notFound();
  return json(200, { invoice });
}
