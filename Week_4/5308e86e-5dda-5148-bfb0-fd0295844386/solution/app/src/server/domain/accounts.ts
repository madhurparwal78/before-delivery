/** Accounts, available balances (balance minus holds) and the snapshot with its sparklines. */
import type { Tx } from "../db.js";
import { addDays, endOfNewYorkDay, newYorkDate } from "../clock.js";
import { SPARKLINE_DAYS, type AccountKind } from "../../shared/rules.js";
import { isId, newId } from "../ids.js";
import { notFound } from "../http/errors.js";

/** The available balance is the booked balance minus the debits of payments waiting for approval. One definition. */
const ACCOUNT_SELECT = `
  SELECT a.id, a.name, a.kind, a.balance_cents, a.company_id,
         a.balance_cents - COALESCE((
           SELECT SUM(p.total_debit_cents) FROM payments p
           WHERE p.source_account_id = a.id AND p.status = 'pending_approval'), 0)::bigint AS available_cents
  FROM accounts a`;

interface AccountView {
  id: string;
  name: string;
  kind: AccountKind;
  balance_cents: number;
  available_cents: number;
  currency: "USD";
}

export function accountView(row: Record<string, any>): AccountView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    balance_cents: row.balance_cents,
    available_cents: row.available_cents,
    currency: "USD",
  };
}

export async function listAccounts(tx: Tx, companyId: string): Promise<AccountView[]> {
  const found = await tx.query(`${ACCOUNT_SELECT} WHERE a.company_id = $1 ORDER BY a.position`, [companyId]);
  return found.rows.map(accountView);
}

/** An account of the company by id, or 404; optionally locking its row. */
export async function findAccount(tx: Tx, companyId: string, id: unknown, lock = false): Promise<Record<string, any>> {
  if (!isId(id)) throw notFound();
  if (lock) {
    // Lock first, then read: the available balance must be computed after the lock is held, not in the same statement.
    const locked = await tx.query("SELECT 1 FROM accounts WHERE id = $1 AND company_id = $2 FOR UPDATE", [id, companyId]);
    if (!locked.rows[0]) throw notFound();
  }
  const found = await tx.query(`${ACCOUNT_SELECT} WHERE a.id = $1 AND a.company_id = $2`, [id, companyId]);
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

/** Locks accounts in id order so opposite transfers never deadlock; returns them keyed by id. */
export async function lockAccounts(tx: Tx, companyId: string, ids: string[]): Promise<Map<string, Record<string, any>>> {
  const ordered = [...new Set(ids)].sort();
  const locked = new Map<string, Record<string, any>>();
  for (const id of ordered) locked.set(id, await findAccount(tx, companyId, id, true));
  return locked;
}

export async function createAccount(tx: Tx, companyId: string, name: string, kind: AccountKind, createdAt: Date): Promise<AccountView> {
  const id = newId();
  await tx.query("INSERT INTO accounts (id, company_id, name, kind, balance_cents, created_at) VALUES ($1, $2, $3, $4, 0, $5)", [id, companyId, name, kind, createdAt]);
  return accountView(await findAccount(tx, companyId, id));
}

interface SnapshotEntry {
  account_id: string;
  balance_cents: number;
  available_cents: number;
  sparkline: number[];
}

interface Snapshot {
  total_cash_cents: number;
  total_available_cents: number;
  per_account: SnapshotEntry[];
}

/** Balances at 23:59:59.999 New York time on each of the last thirty New York dates, oldest first. */
async function sparklines(tx: Tx, companyId: string, today: string): Promise<Map<string, number[]>> {
  const instants: Date[] = [];
  for (let back = SPARKLINE_DAYS - 1; back >= 0; back--) instants.push(endOfNewYorkDay(addDays(today, -back)));
  const found = await tx.query<{ account_id: string; slot: number; balance: number }>(
    `SELECT a.id AS account_id, g.slot::int AS slot,
            COALESCE(SUM(CASE t.direction WHEN 'credit' THEN t.amount_cents ELSE -t.amount_cents END), 0)::bigint AS balance
     FROM accounts a
     CROSS JOIN unnest($2::timestamptz[]) WITH ORDINALITY AS g(day_end, slot)
     LEFT JOIN transactions t ON t.account_id = a.id AND t.created_at <= g.day_end
     WHERE a.company_id = $1
     GROUP BY a.id, g.slot`,
    [companyId, instants],
  );
  const lines = new Map<string, number[]>();
  for (const row of found.rows) {
    const line = lines.get(row.account_id) ?? new Array<number>(SPARKLINE_DAYS).fill(0);
    line[row.slot - 1] = row.balance;
    lines.set(row.account_id, line);
  }
  return lines;
}

/** Everything in one answer is read from one database snapshot. */
export async function readSnapshot(tx: Tx, companyId: string, now: Date): Promise<Snapshot> {
  const accounts = await listAccounts(tx, companyId);
  const lines = await sparklines(tx, companyId, newYorkDate(now));
  const perAccount = accounts.map((account) => {
    const line = lines.get(account.id) ?? new Array<number>(SPARKLINE_DAYS).fill(0);
    line[SPARKLINE_DAYS - 1] = account.balance_cents;
    return { account_id: account.id, balance_cents: account.balance_cents, available_cents: account.available_cents, sparkline: line };
  });
  return {
    total_cash_cents: perAccount.reduce((sum, entry) => sum + entry.balance_cents, 0),
    total_available_cents: perAccount.reduce((sum, entry) => sum + entry.available_cents, 0),
    per_account: perAccount,
  };
}
