// The exchange-rate table: the rate in effect at a moment, scheduled rates and founder additions.
import { one, rows, type Db } from "../db.js";
import { FIELD_COPY, FieldErrors } from "../errors.js";
import type { Currency } from "../../shared/money.js";

const RATE_CURRENCIES = ["EUR", "USD", "JPY"] as const;
type RateCurrency = (typeof RATE_CURRENCIES)[number];
type Rate = { currency: RateCurrency; rate: string; effective_at: string };

type RateRow = { currency: RateCurrency; rate: string; effective_at: Date };
const toRate = (row: RateRow): Rate => ({ currency: row.currency, rate: row.rate, effective_at: row.effective_at.toISOString() });

/** The rate with the latest effective_at not after `at`; on a tie, the one created later. GBP is 1.0000. */
export async function rateInEffect(db: Db, currency: Currency, at: Date): Promise<string> {
  if (currency === "GBP") return "1.0000";
  const row = await one<{ rate: string }>(
    db,
    "SELECT rate::text AS rate FROM exchange_rates WHERE currency = $1 AND effective_at <= $2 ORDER BY effective_at DESC, created_at DESC, id DESC LIMIT 1",
    [currency, at],
  );
  if (!row) throw new Error(`no ${currency} rate in effect`);
  return row.rate;
}

export async function rateTable(db: Db, now: Date): Promise<{ rates: Rate[]; scheduled: Rate[] }> {
  const current = await rows<RateRow>(
    db,
    `SELECT DISTINCT ON (currency) currency, rate::text AS rate, effective_at FROM exchange_rates
     WHERE effective_at <= $1 ORDER BY currency, effective_at DESC, created_at DESC, id DESC`,
    [now],
  );
  const scheduled = await rows<RateRow>(
    db,
    "SELECT currency, rate::text AS rate, effective_at FROM exchange_rates WHERE effective_at > $1 ORDER BY effective_at, created_at, id",
    [now],
  );
  const order = (r: RateRow): number => RATE_CURRENCIES.indexOf(r.currency);
  return { rates: current.sort((a, b) => order(a) - order(b)).map(toRate), scheduled: scheduled.map(toRate) };
}

export async function addRate(db: Db, body: Record<string, unknown>, arrivedAt: Date): Promise<Rate> {
  const errors = new FieldErrors();
  const currency = body.currency;
  if (typeof currency !== "string" || !(RATE_CURRENCIES as readonly string[]).includes(currency)) errors.add("currency", FIELD_COPY.currency_rate);
  const raw = typeof body.rate === "string" || typeof body.rate === "number" ? String(body.rate) : "";
  const match = /^(\d{1,4})(?:\.(\d{1,4}))?$/.exec(raw);
  const rate = match ? `${match[1]}.${(match[2] ?? "").padEnd(4, "0")}` : null;
  const scaled = rate ? BigInt(rate.replace(".", "")) : 0n;
  if (!rate || scaled < 1n || scaled > 10_000_000n) errors.add("rate", FIELD_COPY.rate);
  let effectiveAt = arrivedAt;
  if (body.effective_at !== undefined && body.effective_at !== null) {
    const parsed = typeof body.effective_at === "string" ? new Date(body.effective_at) : new Date(Number.NaN);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() < arrivedAt.getTime() - 1_000) errors.add("effective_at", FIELD_COPY.effective_at);
    else effectiveAt = parsed;
  }
  errors.throwIfAny();
  const row = await one<RateRow>(
    db,
    "INSERT INTO exchange_rates (currency, rate, effective_at) VALUES ($1, $2, $3) RETURNING currency, rate::text AS rate, effective_at",
    [currency, rate, effectiveAt],
  );
  if (!row) throw new Error("rate insert returned nothing");
  return toRate(row);
}
