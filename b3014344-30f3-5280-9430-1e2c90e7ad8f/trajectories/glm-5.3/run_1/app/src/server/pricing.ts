import type { Db } from './db.js';
import type { Amount, Currency } from './money.js';
import { amountFromMinor } from './money.js';
import type { PlanId } from './domain.js';
import { HttpError } from './util.js';

export interface PriceRow {
  id: string;
  plan: PlanId;
  currency: Currency;
  amount: Amount;
  effectiveAt: Date;
}

export async function priceInEffect(db: Db, plan: PlanId, currency: Currency, at: Date): Promise<PriceRow | null> {
  const result = await db.query(
    `SELECT id, plan, currency, amount_minor, effective_at
     FROM prices
     WHERE plan = $1 AND currency = $2 AND effective_at <= $3
     ORDER BY effective_at DESC
     LIMIT 1`,
    [plan, currency, at.toISOString()],
  );
  if ((result.rowCount ?? 0) === 0) return null;
  const row = result.rows[0] as { id: string; plan: PlanId; currency: Currency; amount_minor: string; effective_at: Date };
  return {
    id: row.id,
    plan: row.plan,
    currency: row.currency,
    amount: amountFromMinor(row.currency, BigInt(row.amount_minor)),
    effectiveAt: new Date(row.effective_at),
  };
}

export async function listPrices(db: Db): Promise<PriceRow[]> {
  const result = await db.query('SELECT id, plan, currency, amount_minor, effective_at FROM prices ORDER BY effective_at ASC');
  return (result.rows as { id: string; plan: PlanId; currency: Currency; amount_minor: string; effective_at: Date }[]).map((row) => ({
    id: row.id,
    plan: row.plan,
    currency: row.currency,
    amount: amountFromMinor(row.currency, BigInt(row.amount_minor)),
    effectiveAt: new Date(row.effective_at),
  }));
}

export async function insertPrice(db: Db, input: { plan: PlanId; currency: Currency; amount: Amount; effectiveAt: Date }): Promise<PriceRow> {
  const id = crypto.randomUUID();
  await db.query(
    'INSERT INTO prices (id, plan, currency, amount_minor, effective_at) VALUES ($1, $2, $3, $4, $5)',
    [id, input.plan, input.currency, input.amount.minor, input.effectiveAt.toISOString()],
  );
  return { id, plan: input.plan, currency: input.currency, amount: input.amount, effectiveAt: input.effectiveAt };
}

export async function nextOrderNumber(db: Db): Promise<string> {
  const result = await db.query('SELECT number FROM orders ORDER BY number DESC LIMIT 1');
  let highest = 6;
  if ((result.rowCount ?? 0) > 0) {
    const row = result.rows[0] as { number: string };
    const match = /^PB-(\d{4})$/.exec(row.number);
    if (match) highest = Number(match[1]);
  }
  return `PB-${String(highest + 1).padStart(4, '0')}`;
}

export function invalidAmount(message: string): HttpError {
  return new HttpError(422, 'invalid_amount', message, { amount: message });
}
