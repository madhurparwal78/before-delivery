// Charges in Kill Bill: stable charge keys, item descriptions, and reconciliation of earlier uncertain attempts.
import { one, pool, rows } from "./db.js";
import { ApiError } from "./errors.js";
import { deadlineFromNow, ensureAccount, listInvoices, postCharge, type Deadline, type KillBillItem } from "./killbill.js";
import { formatCents, formatHundredths, parseMoney } from "./money.js";

export const timesheetChargeKey = (timesheetId: string): string => `ts-${timesheetId}`;
export const cancellationChargeKey = (requestId: string): string => `cx-${requestId}`;

export function timesheetDescription(key: string, ref: string, interpreter: string, billedHundredths: number, rateCents: number): string {
  return `[${key}] ${ref} interpreting: ${interpreter}, ${formatHundredths(billedHundredths)} h at $${formatCents(rateCents)}/h`;
}

export function cancellationDescription(key: string, ref: string, seated: number, chargeHundredths: number, rateCents: number): string {
  return `[${key}] ${ref} late cancellation: ${seated} x ${formatHundredths(chargeHundredths)} h at $${formatCents(rateCents)}/h`;
}

const hundredths = (text: string): number => {
  const value = parseMoney(text);
  if (value === null) throw new ApiError("internal");
  return value;
};

/** The rate a timesheet item recorded: "... 2.00 h at $80.00/h". */
export function timesheetChargeTerms(item: KillBillItem): { amountCents: number; rateCents: number } {
  const m = / at \$(\d+\.\d{2})\/h$/.exec(item.description);
  if (!m?.[1]) throw new ApiError("internal");
  return { amountCents: item.amountCents, rateCents: hundredths(m[1]) };
}

/** The quote terms a cancellation item recorded: "... 2 x 2.00 h at $105.00/h". */
export function cancellationChargeTerms(item: KillBillItem): { feeCents: number; seated: number; chargeHundredths: number; rateCents: number } {
  const m = / late cancellation: (\d+) x (\d+\.\d{2}) h at \$(\d+\.\d{2})\/h$/.exec(item.description);
  if (!m?.[1] || !m[2] || !m[3]) throw new ApiError("internal");
  return { feeCents: item.amountCents, seated: Number.parseInt(m[1], 10), chargeHundredths: hundredths(m[2]), rateCents: hundredths(m[3]) };
}

interface ChargeAccount {
  accountId: string;
  deadline: Deadline;
}

/** The organisation's Kill Bill account, created on first need and remembered. */
export async function chargeAccount(orgId: string, deadline: Deadline): Promise<ChargeAccount> {
  const org = await one<{ name: string; killbill_account_id: string | null }>(pool, "SELECT name, killbill_account_id FROM orgs WHERE id = $1", [orgId]);
  if (!org) throw new ApiError("not_found");
  if (org.killbill_account_id) return { accountId: org.killbill_account_id, deadline };
  const accountId = await ensureAccount(orgId, org.name, deadline);
  await pool.query("UPDATE orgs SET killbill_account_id = $2 WHERE id = $1", [orgId, accountId]);
  return { accountId, deadline };
}

/**
 * The item an earlier attempt of this action left in Kill Bill, if any. Only actions that
 * once sent a charge can have one, so Kill Bill is read only for those.
 */
export async function earlierCharge(orgId: string, key: string, deadline: Deadline): Promise<KillBillItem | null> {
  const attempted = await one(pool, "SELECT 1 FROM charge_attempts WHERE charge_key = $1", [key]);
  if (!attempted) return null;
  const account = await chargeAccount(orgId, deadline);
  const invoices = await listInvoices(account.accountId, deadline);
  return invoices.flatMap((invoice) => invoice.items).find((item) => item.description.startsWith(`[${key}]`)) ?? null;
}

/** Records the attempt (outside the caller's transaction, so it survives a rollback), then posts the charge. */
export async function postNewCharge(account: ChargeAccount, key: string, amountCents: number, description: string): Promise<string> {
  await pool.query("INSERT INTO charge_attempts (charge_key) VALUES ($1) ON CONFLICT DO NOTHING", [key]);
  return postCharge(account.accountId, amountCents, description, account.deadline);
}

/** Creates any organisation's missing Kill Bill account; run at start and retried until Kill Bill answers. */
export async function ensureAllAccounts(): Promise<void> {
  const missing = await rows<{ id: string }>(pool, "SELECT id FROM orgs WHERE killbill_account_id IS NULL ORDER BY id");
  for (const org of missing) await chargeAccount(org.id, deadlineFromNow());
}
