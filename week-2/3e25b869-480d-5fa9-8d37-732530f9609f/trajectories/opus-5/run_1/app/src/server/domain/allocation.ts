import { applyRate, money, rateValue, sumTaxes } from '../../shared/money.js';
import type { Money, RefundAllocation, TaxLine } from '../../shared/types.js';

export type RefundTarget = {
  shippingFeeCents: number;
  taxes: readonly TaxLine[];
  /** Allocations of the order's earlier issued refunds, oldest first. */
  earlier: readonly RefundAllocation[];
};

/**
 * Splits a refund across bars, shipping and each tax. A refund that clears the order's last
 * unrefunded bars carries the shipping fee and whatever tax the earlier refunds left behind, so the
 * issued refunds of an order sum exactly to its total.
 */
export function allocateRefund(
  target: RefundTarget,
  refundedBarCents: number,
  isFinal: boolean,
): { allocation: RefundAllocation; amount: Money } {
  const taxes: TaxLine[] = target.taxes.map((line, index) => {
    if (!isFinal) {
      return {
        code: line.code,
        rate: line.rate,
        amount: money(applyRate(refundedBarCents, rateValue(line.rate))),
      };
    }
    const alreadyRefunded = target.earlier.reduce((total, earlier) => {
      const earlierLine = earlier.taxes[index];
      return total + (earlierLine ? earlierLine.amount.cents : 0);
    }, 0);
    return {
      code: line.code,
      rate: line.rate,
      amount: money(line.amount.cents - alreadyRefunded),
    };
  });
  const shipping = money(isFinal ? target.shippingFeeCents : 0);
  const allocation: RefundAllocation = { bars: money(refundedBarCents), shipping, taxes };
  return {
    allocation,
    amount: money(refundedBarCents + shipping.cents + sumTaxes(taxes)),
  };
}

export function zeroAllocation(taxes: readonly TaxLine[]): RefundAllocation {
  return {
    bars: money(0),
    shipping: money(0),
    taxes: taxes.map((line) => ({ code: line.code, rate: line.rate, amount: money(0) })),
  };
}
