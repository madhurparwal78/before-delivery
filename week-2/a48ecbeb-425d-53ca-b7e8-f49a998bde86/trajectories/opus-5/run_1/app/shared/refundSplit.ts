import type { FlavourSlug } from './catalogue.js';
import { allocateByLargestRemainder } from './money.js';

export interface RefundSplitLine {
  flavour: FlavourSlug;
  goods_cents: number;
  deposit_cents: number;
}

export interface RefundSplitTax {
  name: string;
  cents: number;
}

export interface RefundSplit {
  lines: RefundSplitLine[];
  shipping_cents: number;
  taxes: RefundSplitTax[];
}

/** An empty split shaped like `remaining`, used as the zero value when summing refunds. */
export function emptySplit(remaining: RefundSplit): RefundSplit {
  return {
    lines: remaining.lines.map((line) => ({
      flavour: line.flavour,
      goods_cents: 0,
      deposit_cents: 0,
    })),
    shipping_cents: 0,
    taxes: remaining.taxes.map((tax) => ({ name: tax.name, cents: 0 })),
  };
}


export function addSplits(left: RefundSplit, right: RefundSplit): RefundSplit {
  return {
    lines: left.lines.map((line, index) => ({
      flavour: line.flavour,
      goods_cents: line.goods_cents + (right.lines[index]?.goods_cents ?? 0),
      deposit_cents: line.deposit_cents + (right.lines[index]?.deposit_cents ?? 0),
    })),
    shipping_cents: left.shipping_cents + right.shipping_cents,
    taxes: left.taxes.map((tax, index) => ({
      name: tax.name,
      cents: tax.cents + (right.taxes[index]?.cents ?? 0),
    })),
  };
}

export function subtractSplits(left: RefundSplit, right: RefundSplit): RefundSplit {
  return {
    lines: left.lines.map((line, index) => ({
      flavour: line.flavour,
      goods_cents: line.goods_cents - (right.lines[index]?.goods_cents ?? 0),
      deposit_cents: line.deposit_cents - (right.lines[index]?.deposit_cents ?? 0),
    })),
    shipping_cents: left.shipping_cents - right.shipping_cents,
    taxes: left.taxes.map((tax, index) => ({
      name: tax.name,
      cents: tax.cents - (right.taxes[index]?.cents ?? 0),
    })),
  };
}

/**
 * Allocates `amountCents` across the order's remaining refundable parts, in this
 * order: each line's discounted goods then that line's deposit, line by line;
 * then shipping; then each tax line in table order. Largest remainder decides the
 * leftover cents, so no part ever goes below zero remaining.
 */
export function splitRefund(amountCents: number, remaining: RefundSplit): RefundSplit {
  const weights: number[] = [];
  for (const line of remaining.lines) {
    weights.push(line.goods_cents, line.deposit_cents);
  }
  weights.push(remaining.shipping_cents);
  for (const tax of remaining.taxes) weights.push(tax.cents);

  const shares = allocateByLargestRemainder(amountCents, weights);
  let cursor = 0;
  const lines = remaining.lines.map((line) => ({
    flavour: line.flavour,
    goods_cents: shares[cursor++]!,
    deposit_cents: shares[cursor++]!,
  }));
  const shipping_cents = shares[cursor++]!;
  const taxes = remaining.taxes.map((tax) => ({ name: tax.name, cents: shares[cursor++]! }));
  return { lines, shipping_cents, taxes };
}
