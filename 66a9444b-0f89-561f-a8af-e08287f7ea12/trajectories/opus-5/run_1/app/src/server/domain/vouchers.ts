import { one, type Queryable } from '../db/pool.js';
import { newId } from '../lib/codes.js';

export type MovementKind = 'issue' | 'redeem' | 'return';

export function voucherAccount(code: string): string {
  return `voucher:${code}`;
}

/** A voucher's balance is its credits minus its debits. */
export async function voucherBalance(db: Queryable, code: string): Promise<number> {
  const row = await one<{ balance: number }>(
    db,
    `SELECT COALESCE(SUM(CASE WHEN side = 'credit' THEN amount_cents ELSE -amount_cents END), 0)
            AS balance
     FROM ledger_entries WHERE account = $1`,
    [voucherAccount(code)],
  );
  return row?.balance ?? 0;
}

export async function voucherExists(db: Queryable, code: string): Promise<boolean> {
  const row = await one<{ code: string }>(db, `SELECT code FROM vouchers WHERE code = $1`, [code]);
  return row !== null;
}

/** Redemptions of one voucher are serialised, so a balance never goes below zero. */
export async function lockVoucher(db: Queryable, code: string): Promise<boolean> {
  const row = await one<{ code: string }>(
    db,
    `SELECT code FROM vouchers WHERE code = $1 FOR UPDATE`,
    [code],
  );
  return row !== null;
}

interface MovementInput {
  kind: MovementKind;
  code: string;
  amountCents: number;
  actor: string;
  orderRef: string | null;
}

/** Every money movement on a voucher is one movement with exactly two equal entries. */
export async function recordMovement(db: Queryable, input: MovementInput): Promise<string> {
  const movementId = newId();
  await db.query(
    `INSERT INTO ledger_movements (id, kind, amount_cents, actor, order_ref, voucher_code)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [movementId, input.kind, input.amountCents, input.actor, input.orderRef, input.code],
  );

  const voucher = voucherAccount(input.code);
  const orderAccount = input.orderRef === null ? 'voucher-sales' : `order:${input.orderRef}`;
  const pair: ReadonlyArray<readonly [string, 'debit' | 'credit']> =
    input.kind === 'issue'
      ? [
          ['voucher-sales', 'debit'],
          [voucher, 'credit'],
        ]
      : input.kind === 'redeem'
        ? [
            [voucher, 'debit'],
            [orderAccount, 'credit'],
          ]
        : [
            [orderAccount, 'debit'],
            [voucher, 'credit'],
          ];

  for (const [account, side] of pair) {
    await db.query(
      `INSERT INTO ledger_entries (id, movement_id, account, side, amount_cents)
       VALUES ($1, $2, $3, $4, $5)`,
      [newId(), movementId, account, side, input.amountCents],
    );
  }
  return movementId;
}
