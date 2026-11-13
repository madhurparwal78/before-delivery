import { Db } from '../db/pool';
import { codeExhausted, codeExpired, codeInvalid, codeNotApplicable, minimumNotMet } from '../errors';

export type DiscountRow = {
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  collection: string | null;
  minimum: number;
  starts_at: Date;
  ends_at: Date;
  usage_limit: number | null;
  used: number;
};

export function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isGiftCardCode(raw: string): boolean {
  return normaliseCode(raw).startsWith('RHGC-');
}

export async function loadDiscount(client: Db, code: string): Promise<DiscountRow | null> {
  return client.one<DiscountRow>('SELECT * FROM discount_codes WHERE code = $1', [normaliseCode(code)]);
}

export function assertDiscountUsable(
  row: DiscountRow | null,
  now: Date,
  eligibleSubtotal: number,
  hasEligibleLine: boolean
): DiscountRow {
  if (row === null || now.getTime() < new Date(row.starts_at).getTime()) throw codeInvalid();
  if (now.getTime() >= new Date(row.ends_at).getTime()) throw codeExpired(new Date(row.ends_at));
  if (row.usage_limit !== null && row.used >= row.usage_limit) throw codeExhausted();
  if (!hasEligibleLine) throw codeNotApplicable();
  if (eligibleSubtotal < row.minimum) throw minimumNotMet(row.minimum - eligibleSubtotal);
  return row;
}

export function discountStillApplies(
  row: DiscountRow | null,
  now: Date,
  eligibleSubtotal: number,
  hasEligibleLine: boolean
): boolean {
  try {
    assertDiscountUsable(row, now, eligibleSubtotal, hasEligibleLine);
    return true;
  } catch {
    return false;
  }
}
