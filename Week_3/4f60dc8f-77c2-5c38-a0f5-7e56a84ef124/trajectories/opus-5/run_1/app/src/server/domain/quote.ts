import {
  SHOT_ORDER,
  type QuoteLineView,
  type QuoteView,
  type Service,
} from '../../shared/domain.js';
import {
  convertPence,
  exponentOf,
  formatRate,
  splitMilestones,
  vatOn,
  type CurrencyCode,
} from '../../shared/money.js';

export type QuoteLineRow = {
  shotCode: string;
  quantity: number;
  lockedTitle: string | null;
  lockedPricePence: number | null;
};

export type QuoteInput = {
  currency: CurrencyCode;
  revision: number;
  rateE4: bigint;
  fxLockedAt: Date | null;
  lines: readonly QuoteLineRow[];
  services: readonly Service[];
};

/**
 * The title rule: until the deposit a line shows its service record's current title and
 * price; the deposit locks both onto the line.
 */
export const resolvedLine = (
  row: QuoteLineRow,
  services: readonly Service[],
): { title: string; unitPricePence: number } => {
  const service = services.find((entry) => entry.code === row.shotCode);
  return {
    title: row.lockedTitle ?? service?.title ?? row.shotCode,
    unitPricePence: row.lockedPricePence ?? service?.list_price_pence ?? 0,
  };
};

export const buildQuote = (input: QuoteInput): QuoteView => {
  const ordered = [...input.lines].sort(
    (a, b) =>
      (SHOT_ORDER as readonly string[]).indexOf(a.shotCode) -
      (SHOT_ORDER as readonly string[]).indexOf(b.shotCode),
  );

  const lines: QuoteLineView[] = ordered.map((row) => {
    const { title, unitPricePence } = resolvedLine(row, input.services);
    const pence = BigInt(unitPricePence) * BigInt(row.quantity);
    return {
      shot_code: row.shotCode,
      title,
      quantity: row.quantity,
      unit_price_gbp_minor: unitPricePence,
      amount_minor: Number(convertPence(pence, input.rateE4, input.currency)),
    };
  });

  const subtotal = lines.reduce((total, line) => total + BigInt(line.amount_minor), 0n);
  const vat = vatOn(subtotal);
  const total = subtotal + vat;
  const split = splitMilestones(total);

  return {
    currency: input.currency,
    exponent: exponentOf(input.currency),
    revision: input.revision,
    fx_rate: formatRate(input.rateE4),
    fx_locked: input.fxLockedAt !== null,
    fx_locked_at: input.fxLockedAt === null ? null : input.fxLockedAt.toISOString(),
    lines,
    subtotal_minor: Number(subtotal),
    vat_minor: Number(vat),
    total_minor: Number(total),
    milestones: {
      deposit_minor: Number(split.depositMinor),
      look_dev_minor: Number(split.lookDevMinor),
      final_delivery_minor: Number(split.finalDeliveryMinor),
    },
  };
};
