// Gift vouchers and their ledger: every movement is two entries of equal amount, never edited.
import { db, transaction, type Db } from "../db/index.ts";
import { FieldErrors, notFound, ok, route } from "../http.ts";
import { audit, type Actor } from "./audit.ts";
import { newId, newVoucherCode } from "./ids.ts";
import { isoUtc } from "./time.ts";
import { asObject, intOrNull } from "./validate.ts";

type MovementKind = "issue" | "redeem" | "return";

const voucherAccount = (code: string) => `voucher:${code}`;
const orderAccount = (ref: string) => `order:${ref}`;

/** Debit and credit sides of each movement kind (brief: Gift vouchers and the ledger). */
function sides(kind: MovementKind, code: string, ref: string | null): { debit: string; credit: string } {
  if (kind === "issue") return { debit: "voucher-sales", credit: voucherAccount(code) };
  if (kind === "redeem") return { debit: voucherAccount(code), credit: orderAccount(ref!) };
  return { debit: orderAccount(ref!), credit: voucherAccount(code) };
}

export async function recordMovement(q: Db, kind: MovementKind, code: string, cents: number, actor: string, ref: string | null): Promise<void> {
  const id = newId();
  const { debit, credit } = sides(kind, code, ref);
  await q.query("INSERT INTO voucher_movements (id, voucher_code, kind, amount_cents, created_at, actor, order_ref) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, code, kind, cents, new Date(), actor, ref]);
  await q.query("INSERT INTO ledger_entries (movement_id, account, side, amount_cents) VALUES ($1, $2, 'debit', $4), ($1, $3, 'credit', $4)",
    [id, debit, credit, cents]);
}

/** An account's balance is its credits minus its debits. */
async function accountBalance(q: Db, account: string): Promise<number> {
  return (await q.one<{ n: number }>(
    "SELECT COALESCE(sum(CASE WHEN side = 'credit' THEN amount_cents ELSE -amount_cents END), 0)::integer AS n FROM ledger_entries WHERE account = $1",
    [account]))!.n;
}

/** Locks the voucher so redemptions of one voucher are serialised; null when the code is unknown. */
export async function lockVoucher(q: Db, code: string): Promise<{ code: string; balance: number } | null> {
  const row = await q.one<{ code: string }>("SELECT code FROM vouchers WHERE code = $1 FOR UPDATE", [code]);
  return row ? { code: row.code, balance: await accountBalance(q, voucherAccount(row.code)) } : null;
}

export async function issueVoucher(q: Db, code: string, cents: number, note: string | null, actor: string): Promise<void> {
  await q.query("INSERT INTO vouchers (code, note, created_at) VALUES ($1, $2, $3)", [code, note, new Date()]);
  await recordMovement(q, "issue", code, cents, actor, null);
}

route("GET", "/api/vouchers/:code", "signed-in", async (ctx) => {
  const code = ctx.params.code!.trim().toUpperCase();
  const row = await db.one("SELECT code FROM vouchers WHERE code = $1", [code]);
  if (!row) throw notFound();
  return ok({ code, balance_cents: await accountBalance(db, voucherAccount(code)) });
});

route("POST", "/api/finance/vouchers", ["finance"], async (ctx) => {
  const body = asObject(ctx.body);
  const cents = intOrNull(body.amount_cents);
  if (cents === null || cents < 1 || cents > 100000) throw new FieldErrors({ amount_cents: "out_of_range" });
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;
  const code = newVoucherCode();
  await transaction(async (tx) => {
    await issueVoucher(tx, code, cents, note, ctx.user.email);
    await audit(tx, ctx.user satisfies Actor, "voucher.issued", { type: "voucher", id: code }, { amount_cents: cents, note });
  });
  return ok({ code, balance_cents: cents }, 201);
});

route("GET", "/api/finance/ledger", ["finance"], async (ctx) => {
  const account = ctx.query.get("account") ?? "";
  const movements = await db.all<{ id: string; kind: MovementKind; amount_cents: number; created_at: Date; actor: string; order_ref: string | null }>(
    `SELECT DISTINCT m.id, m.seq, m.kind, m.amount_cents, m.created_at, m.actor, m.order_ref FROM voucher_movements m
     JOIN ledger_entries e ON e.movement_id = m.id WHERE e.account = $1 ORDER BY m.seq`, [account]);
  if (!movements.length) throw new FieldErrors({ account: "unknown" });
  const entries = await db.all<{ movement_id: string; account: string; side: string; amount_cents: number }>(
    "SELECT movement_id, account, side, amount_cents FROM ledger_entries WHERE movement_id = ANY($1) ORDER BY seq", [movements.map((m) => m.id)]);
  return ok({
    account,
    balance_cents: await accountBalance(db, account),
    movements: movements.map((m) => ({
      id: m.id, kind: m.kind, amount_cents: m.amount_cents, created_at: isoUtc(m.created_at), actor: m.actor, order_ref: m.order_ref,
      entries: entries.filter((e) => e.movement_id === m.id).map((e) => ({ account: e.account, side: e.side, amount_cents: e.amount_cents })),
    })),
  });
});
