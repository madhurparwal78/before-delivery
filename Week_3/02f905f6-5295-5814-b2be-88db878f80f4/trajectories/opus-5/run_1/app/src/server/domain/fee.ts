import type { Plan, Quote, RateSet, SidesIn } from '../../shared/types';
import { cubicMilliToString } from './measure';

/** Divides exactly, rounding half up (an exact half goes up). */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

/** Rates are decimals with four places, held as ten-thousandths of a dollar. */
export function rateToTenThousandths(rate: string): number {
  const [whole = '0', fraction = ''] = rate.split('.');
  return Number(whole) * 10000 + Number((fraction + '0000').slice(0, 4));
}

export function tenThousandthsToRate(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}${Math.floor(abs / 10000)}.${String(abs % 10000).padStart(4, '0')}`;
}

/** The per-cubic-inch rate of a plan: the sum of the stage rates it uses. */
export function ratePerCubicInch(plan: Plan, rateSet: RateSet): number {
  const bisque = rateToTenThousandths(rateSet.bisque_rate);
  const glaze = rateToTenThousandths(rateSet.glaze_rate);
  switch (plan) {
    case 'bisque_only':
      return bisque;
    case 'glaze_only':
      return glaze;
    case 'bisque_and_glaze':
      return bisque + glaze;
  }
}

export interface FeeOutcome {
  ratePerCubicInch: number;
  discountPercent: number;
  feeCents: number;
  minimumApplied: boolean;
}

/**
 * The one place the firing fee is worked out, with the one rounding step.
 * cubicMilli is cubic inches in thousandths.
 */
export function computeFee(args: {
  cubicMilli: number;
  plan: Plan;
  rateSet: RateSet;
  isMember: boolean;
}): FeeOutcome {
  const rate = ratePerCubicInch(args.plan, args.rateSet);
  const discountPercent = args.isMember ? args.rateSet.member_discount_percent : 0;
  // cents = cubic/1000 * rate/10000 * (100-d)/100 * 100
  const amountCents = divRoundHalfUp(
    BigInt(args.cubicMilli) * BigInt(rate) * BigInt(100 - discountPercent),
    10_000_000n,
  );
  const minimum = BigInt(args.rateSet.order_minimum_cents);
  const minimumApplied = minimum > amountCents;
  return {
    ratePerCubicInch: rate,
    discountPercent,
    feeCents: Number(minimumApplied ? minimum : amountCents),
    minimumApplied,
  };
}

export function quoteOf(args: {
  sidesIn: SidesIn;
  cubicMilli: number;
  plan: Plan;
  rateSet: RateSet;
  isMember: boolean;
}): Quote {
  const fee = computeFee(args);
  return {
    sides_in: args.sidesIn,
    cubic_inches: cubicMilliToString(args.cubicMilli),
    rate_per_cubic_inch: tenThousandthsToRate(fee.ratePerCubicInch),
    discount_percent: fee.discountPercent,
    order_minimum_cents: args.rateSet.order_minimum_cents,
    minimum_applied: fee.minimumApplied,
    fee_cents: fee.feeCents,
    rate_set_id: args.rateSet.id,
  };
}

export const RATE_FIELD_MSG = {
  rate: 'Enter a rate above 0.0000 and at most 1.0000',
  discount: 'Enter a whole percent from 0 to 50',
  minimum: 'Enter an amount from $0.00 to $100.00',
  effectiveDate: 'Choose today or a later date',
  effectiveDateFormat: 'Enter a date as YYYY-MM-DD',
} as const;

export interface RateSetInput {
  bisque_rate: unknown;
  glaze_rate: unknown;
  member_discount_percent: unknown;
  order_minimum_cents: unknown;
  effective_date: unknown;
}

export interface RateSetDraft {
  bisque_rate: string;
  glaze_rate: string;
  member_discount_percent: number;
  order_minimum_cents: number;
  effective_date: string;
}

function parseRate(raw: unknown): number | null {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : null;
  if (text === null || !/^\d+(\.\d{1,4})?$/.test(text)) return null;
  const value = rateToTenThousandths(text);
  if (value <= 0 || value > 10000) return null;
  return value;
}

/** Validates a new rate set against the house limits. `today` is the studio date. */
export function validateRateSet(
  input: RateSetInput,
  today: string,
): { draft: RateSetDraft | null; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const bisque = parseRate(input.bisque_rate);
  const glaze = parseRate(input.glaze_rate);
  if (bisque === null) fields.bisque_rate = RATE_FIELD_MSG.rate;
  if (glaze === null) fields.glaze_rate = RATE_FIELD_MSG.rate;

  const discountRaw = input.member_discount_percent;
  const discount =
    typeof discountRaw === 'number'
      ? discountRaw
      : typeof discountRaw === 'string' && /^\d+$/.test(discountRaw.trim())
        ? Number(discountRaw.trim())
        : NaN;
  if (!Number.isInteger(discount) || discount < 0 || discount > 50) {
    fields.member_discount_percent = RATE_FIELD_MSG.discount;
  }

  const minimumRaw = input.order_minimum_cents;
  const minimum =
    typeof minimumRaw === 'number'
      ? minimumRaw
      : typeof minimumRaw === 'string' && /^\d+$/.test(minimumRaw.trim())
        ? Number(minimumRaw.trim())
        : NaN;
  if (!Number.isInteger(minimum) || minimum < 0 || minimum > 10000) {
    fields.order_minimum_cents = RATE_FIELD_MSG.minimum;
  }

  const dateRaw = typeof input.effective_date === 'string' ? input.effective_date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
    fields.effective_date = RATE_FIELD_MSG.effectiveDateFormat;
  } else if (dateRaw < today) {
    fields.effective_date = RATE_FIELD_MSG.effectiveDate;
  }

  if (Object.keys(fields).length > 0) return { draft: null, fields };
  return {
    draft: {
      bisque_rate: tenThousandthsToRate(bisque as number),
      glaze_rate: tenThousandthsToRate(glaze as number),
      member_discount_percent: discount,
      order_minimum_cents: minimum,
      effective_date: dateRaw,
    },
    fields,
  };
}
