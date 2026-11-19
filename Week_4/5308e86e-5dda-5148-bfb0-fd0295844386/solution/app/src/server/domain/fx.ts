/** Currency quotes: fixed rates, round half up, a one percent fee, single use. */
import type { Tx } from "../db.js";
import { CURRENCY_RATES_PER_DOLLAR, QUOTE_FEE_PERCENT } from "../../shared/rules.js";
import { config } from "../config.js";
import { Fields, notFound } from "../http/errors.js";
import { newId, isId } from "../ids.js";
import { readAmountCents } from "./validate.js";

/** a * numerator / denominator rounded half up, in exact integers. */
function roundHalfUp(amount: number, numerator: number, denominator: number): number {
  const scaled = BigInt(amount) * BigInt(numerator);
  const divisor = BigInt(denominator);
  return Number((2n * scaled + divisor) / (2n * divisor));
}

interface QuoteView {
  id: string;
  currency: string;
  amount_cents: number;
  rate: string;
  foreign_amount_minor: number;
  fee_cents: number;
  total_debit_cents: number;
  expires_at: string;
}

function formatRate(whole: number, scale: number): string {
  const decimals = String(scale).length - 1;
  const padded = String(whole).padStart(decimals + 1, "0");
  return `${padded.slice(0, padded.length - decimals)}.${padded.slice(padded.length - decimals)}`;
}

export async function createQuote(tx: Tx, companyId: string, body: Record<string, unknown>, now: Date): Promise<QuoteView> {
  const fields = new Fields();
  const currency = typeof body.currency === "string" ? body.currency : "";
  const rate = Object.hasOwn(CURRENCY_RATES_PER_DOLLAR, currency) ? CURRENCY_RATES_PER_DOLLAR[currency] : undefined;
  if (!rate) fields.fail("currency", "Choose EUR, GBP or CAD");
  const amount = readAmountCents(body.amount_cents, fields, "amount_cents");
  fields.raise();
  if (!rate || amount === null) throw new Error("unreachable: validated quote");
  const foreign = roundHalfUp(amount, rate.whole, rate.scale);
  const fee = roundHalfUp(amount, QUOTE_FEE_PERCENT, 100);
  const id = newId();
  const expiresAt = new Date(now.getTime() + config.fxQuoteTtlSeconds * 1000);
  await tx.query(
    `INSERT INTO fx_quotes (id, company_id, currency, amount_cents, rate, foreign_amount_minor, fee_cents, total_debit_cents, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, companyId, currency, amount, formatRate(rate.whole, rate.scale), foreign, fee, amount + fee, now, expiresAt],
  );
  return {
    id,
    currency,
    amount_cents: amount,
    rate: formatRate(rate.whole, rate.scale),
    foreign_amount_minor: foreign,
    fee_cents: fee,
    total_debit_cents: amount + fee,
    expires_at: expiresAt.toISOString(),
  };
}

/** A quote of the company by id, row-locked so simultaneous uses are applied one at a time; 404 otherwise. */
export async function lockQuote(tx: Tx, companyId: string, id: unknown): Promise<Record<string, any>> {
  if (!isId(id)) throw notFound();
  const found = await tx.query("SELECT * FROM fx_quotes WHERE id = $1 AND company_id = $2 FOR UPDATE", [id, companyId]);
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}
