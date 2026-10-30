import type { PoolClient } from "pg";
import { query, type Row } from "../db.js";
import { errors, validationError } from "../errors.js";

// Every voucher movement carries exactly two equal entries, and a voucher's
// balance is its credits minus its debits. Redemptions serialise on the
// voucher row so a balance never goes below zero.

export type MovementKind = "issue" | "redeem" | "return";

export async function voucherBalance(client: PoolClient, code: string): Promise<number> {
  const res = await client.query(
    `select coalesce(sum(case when side = 'credit' then amount_cents else -amount_cents end), 0) as balance
     from ledger_entries where account = $1`,
    [`voucher:${code}`],
  );
  return Number(res.rows[0]?.balance ?? 0);
}

export async function voucherExists(client: PoolClient, code: string): Promise<boolean> {
  const res = await client.query("select 1 from vouchers where code = $1", [code]);
  return res.rowCount !== null && res.rowCount > 0;
}

async function insertMovement(
  client: PoolClient,
  code: string,
  kind: MovementKind,
  amountCents: number,
  actor: string,
  orderRef: string | null,
  debitAccount: string,
  creditAccount: string,
): Promise<void> {
  const mov = await client.query(
    `insert into voucher_movements (voucher_code, kind, amount_cents, actor, order_ref)
     values ($1,$2,$3,$4,$5) returning id`,
    [code, kind, amountCents, actor, orderRef],
  );
  const movementId = Number(mov.rows[0].id);
  await client.query(
    `insert into ledger_entries (movement_id, account, side, amount_cents) values
      ($1,$2,'debit',$3), ($1,$4,'credit',$3)`,
    [movementId, debitAccount, amountCents, creditAccount],
  );
}

export async function issueVoucher(client: PoolClient, code: string, amountCents: number, actor: string, note: string): Promise<void> {
  await client.query("insert into vouchers (code, note) values ($1,$2)", [code, note]);
  await insertMovement(client, code, "issue", amountCents, actor, null, "voucher-sales", `voucher:${code}`);
}

export async function redeemVoucher(client: PoolClient, code: string, amountCents: number, actor: string, orderRef: string): Promise<void> {
  const locked = await client.query("select code from vouchers where code = $1 for update", [code]);
  if (locked.rowCount === 0) throw validationError({ voucher_code: "unknown" });
  const balance = await voucherBalance(client, code);
  if (balance <= 0) throw validationError({ voucher_code: "empty" });
  if (amountCents > balance) amountCents = balance;
  await insertMovement(client, code, "redeem", amountCents, actor, orderRef, `voucher:${code}`, `order:${orderRef}`);
}

export async function returnVoucher(client: PoolClient, code: string, amountCents: number, orderRef: string): Promise<void> {
  await insertMovement(client, code, "return", amountCents, "system", orderRef, `order:${orderRef}`, `voucher:${code}`);
}

export async function readLedger(account: string): Promise<Row[]> {
  const res = await query(
    `select m.id, m.kind, m.amount_cents, m.created_at, m.actor, m.order_ref
     from voucher_movements m
     join ledger_entries e on e.movement_id = m.id and e.account = $1
     order by m.id`,
    [account],
  );
  return res.rows;
}

export async function movementEntries(movementIds: number[]): Promise<Map<number, Row[]>> {
  const out = new Map<number, Row[]>();
  if (movementIds.length === 0) return out;
  const res = await query("select * from ledger_entries where movement_id = any($1::int[]) order by id", [movementIds]);
  for (const row of res.rows) {
    const id = Number(row.movement_id);
    out.set(id, [...(out.get(id) ?? []), row]);
  }
  return out;
}
