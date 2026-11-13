import type { Queryable } from "./db";
import { one } from "./db";
import { codeExpired, fail, minimumNotMet } from "./errors";
import { eligible, type DiscountRule, type PricedLine } from "./totals";

interface DiscountRow extends DiscountRule {
  code: string;
  minimum: number;
  starts_at: Date;
  ends_at: Date;
  usage_limit: number | null;
  used: number;
}

/** A code's uses: the uses it came with plus every placed, uncancelled sale made with it. */
export async function findDiscount(db: Queryable, code: string): Promise<DiscountRow | null> {
  return one<DiscountRow>(
    db,
    `SELECT d.code, d.kind, d.value, d.collection, d.minimum, d.starts_at, d.ends_at, d.usage_limit,
            d.used_before + (SELECT count(*) FROM orders o WHERE o.discount_code = d.code AND o.kind = 'sale' AND o.status <> 'cancelled')::int AS used
     FROM discount_codes d WHERE d.code = $1`,
    [code],
  );
}

/**
 * The published checks, in order: unknown or not yet started, expired, fully used, nothing eligible in the bag,
 * eligible subtotal under the minimum.
 */
export async function checkDiscount(db: Queryable, code: string, lines: PricedLine[], now: Date): Promise<DiscountRow> {
  const found = await findDiscount(db, code);
  if (!found || now < found.starts_at) throw fail("code_invalid");
  if (now >= found.ends_at) throw codeExpired(found.ends_at);
  if (found.usage_limit !== null && found.used >= found.usage_limit) throw fail("code_exhausted");
  const pool = lines.filter((line) => eligible(found, line));
  if (pool.length === 0) throw fail("code_not_applicable");
  const subtotal = pool.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  if (subtotal < found.minimum) throw minimumNotMet(found.minimum - subtotal);
  return found;
}
