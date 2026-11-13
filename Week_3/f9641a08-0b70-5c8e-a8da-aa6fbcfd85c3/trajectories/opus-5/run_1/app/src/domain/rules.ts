import { config } from '../config';
import { Airline, CABIN_FIT_CATEGORIES } from './constants';
import { roundHalfUp } from './money';

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function stockBadge(available: number): string {
  if (available <= 0) return 'Out of stock';
  if (available <= config.lowStockThreshold) return `Only ${available} left`;
  return 'In stock';
}

export function isLowStock(available: number): boolean {
  return available >= 0 && available <= config.lowStockThreshold;
}

export function savePercent(price: number, compareAt: number | null): number | null {
  if (compareAt === null || compareAt <= 0) return null;
  return roundHalfUp(((compareAt - price) * 100) / compareAt);
}

export function hasCabinFit(category: string): boolean {
  return CABIN_FIT_CATEGORIES.includes(category);
}

export type Dimensions = { height: number; width: number; depth: number };

export type FitResult = {
  fits: boolean;
  overhang_cm: Dimensions;
  max_overhang_cm: number;
  verdict: string;
};

function trimNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function overhangOf(dimension: number, limit: number): number {
  return Math.round(Math.max(0, dimension - limit) * 10) / 10;
}

export function cabinFit(dimensions: Dimensions, airline: Airline): FitResult {
  const overhang: Dimensions = {
    height: overhangOf(dimensions.height, airline.height_cm),
    width: overhangOf(dimensions.width, airline.width_cm),
    depth: overhangOf(dimensions.depth, airline.depth_cm)
  };
  const max = Math.max(overhang.height, overhang.width, overhang.depth);
  const fits = max === 0;
  return {
    fits,
    overhang_cm: overhang,
    max_overhang_cm: max,
    verdict: fits
      ? `Fits the ${airline.name} cabin frame.`
      : `Over by ${trimNumber(max)} cm for the ${airline.name} cabin frame.`
  };
}

export type TotalsLine = {
  sku: string;
  category: string;
  unit_price: number;
  quantity: number;
};

export type TotalsDiscount = {
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  collection: string | null;
};

export type LineTotals = {
  line_subtotal: number;
  line_discount: number;
  line_net: number;
  line_tax: number;
};

export type Totals = {
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  gift_card: number;
  total: number;
};

export type TotalsResult = {
  lines: LineTotals[];
  totals: Totals;
  grand_total: number;
  shipping_tax: number;
  eligible_subtotal: number;
};

export function discountEligible(line: TotalsLine, discount: TotalsDiscount | null): boolean {
  if (discount === null) return false;
  if (discount.collection === null) return true;
  return line.category === discount.collection;
}

export function computeTotals(input: {
  lines: TotalsLine[];
  discount: TotalsDiscount | null;
  shippingMethod: 'standard' | 'express';
  giftCardBalance: number;
}): TotalsResult {
  const { lines, discount, shippingMethod, giftCardBalance } = input;
  const subtotals = lines.map((line) => line.unit_price * line.quantity);
  const subtotal = subtotals.reduce((sum, value) => sum + value, 0);

  const eligible = lines.map((line) => discountEligible(line, discount));
  const eligibleSubtotal = subtotals.reduce((sum, value, index) => (eligible[index] ? sum + value : sum), 0);

  const discounts = lines.map(() => 0);
  if (discount !== null && eligibleSubtotal > 0) {
    if (discount.kind === 'percent') {
      for (let i = 0; i < lines.length; i += 1) {
        if (eligible[i]) discounts[i] = roundHalfUp((subtotals[i] * discount.value) / 100);
      }
    } else {
      const pot = Math.min(discount.value, eligibleSubtotal);
      let assigned = 0;
      const indices: number[] = [];
      for (let i = 0; i < lines.length; i += 1) {
        if (eligible[i]) {
          discounts[i] = Math.floor((pot * subtotals[i]) / eligibleSubtotal);
          assigned += discounts[i];
          indices.push(i);
        }
      }
      let leftover = pot - assigned;
      let cursor = 0;
      while (leftover > 0 && indices.length > 0) {
        const index = indices[cursor % indices.length];
        if (discounts[index] < subtotals[index]) {
          discounts[index] += 1;
          leftover -= 1;
        }
        cursor += 1;
        if (cursor > indices.length * (pot + 1)) break;
      }
    }
  }

  const nets = subtotals.map((value, index) => value - discounts[index]);
  const discountedSubtotal = nets.reduce((sum, value) => sum + value, 0);

  let shipping: number;
  if (shippingMethod === 'express') {
    shipping = 499;
  } else {
    shipping = discountedSubtotal >= config.freeShippingMinimum ? 0 : 249;
  }
  if (lines.length === 0) shipping = 0;

  const lineTaxes = nets.map((net) => roundHalfUp((net * config.taxRatePercent) / 100));
  const shippingTax = roundHalfUp((shipping * config.taxRatePercent) / 100);
  const tax = lineTaxes.reduce((sum, value) => sum + value, 0) + shippingTax;

  const grandTotal = discountedSubtotal + shipping + tax;
  const giftCard = Math.min(Math.max(giftCardBalance, 0), grandTotal);
  const total = grandTotal - giftCard;

  return {
    lines: lines.map((_line, index) => ({
      line_subtotal: subtotals[index],
      line_discount: discounts[index],
      line_net: nets[index],
      line_tax: lineTaxes[index]
    })),
    totals: {
      subtotal,
      discount: discounts.reduce((sum, value) => sum + value, 0),
      shipping,
      tax,
      gift_card: giftCard,
      total
    },
    grand_total: grandTotal,
    shipping_tax: shippingTax,
    eligible_subtotal: eligibleSubtotal
  };
}

export const ORDER_STATUSES = [
  'placed',
  'packed',
  'partially_shipped',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled'
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_WORDS: Record<string, string> = {
  placed: 'Placed',
  packed: 'Packed',
  partially_shipped: 'Partially shipped',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled'
};

export const TIMELINE_LABELS: Record<string, string> = {
  placed: 'Order placed',
  packed: 'Packed',
  partially_shipped: 'Partially shipped',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled'
};

export const PAYMENT_STATUS_WORDS: Record<string, string> = {
  pending: 'Pending',
  authorized: 'Authorized',
  captured: 'Paid',
  partially_refunded: 'Partially refunded',
  refunded: 'Refunded',
  failed: 'Failed'
};

export function orderStatusTransitionAllowed(from: string, to: string): boolean {
  if (to === 'packed') return from === 'placed';
  if (to === 'out_for_delivery') return from === 'shipped';
  if (to === 'delivered') return from === 'out_for_delivery';
  if (to === 'cancelled') return from === 'placed' || from === 'packed';
  return false;
}

export function canCancelOrder(status: string): boolean {
  return status === 'placed' || status === 'packed';
}

export const RETURN_STATUS_WORDS: Record<string, string> = {
  requested: 'Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  in_transit: 'In transit',
  received: 'Received',
  inspected: 'Inspected',
  refunded: 'Refunded',
  exchanged: 'Exchanged'
};

export const TRIAL_STATUS_WORDS: Record<string, string> = {
  requested: 'Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  returned: 'Returned',
  refunded: 'Refunded'
};

export const CLAIM_STATUS_WORDS: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  repair: 'Repair',
  replacement: 'Replacement',
  resolved: 'Resolved'
};

export const RETURN_TRANSITIONS: Record<string, string[]> = {
  requested: ['approved', 'rejected'],
  approved: ['in_transit'],
  in_transit: ['received'],
  received: ['inspected'],
  inspected: ['refunded', 'exchanged'],
  refunded: [],
  exchanged: [],
  rejected: []
};

export const TRIAL_TRANSITIONS: Record<string, string[]> = {
  requested: ['approved', 'rejected'],
  approved: ['returned'],
  returned: ['refunded'],
  refunded: [],
  rejected: []
};

export const CLAIM_TRANSITIONS: Record<string, string[]> = {
  submitted: ['under_review'],
  under_review: ['approved', 'rejected'],
  approved: ['repair', 'replacement'],
  repair: ['resolved'],
  replacement: ['resolved'],
  resolved: [],
  rejected: []
};

export const OPEN_RETURN_STATUSES = ['requested', 'approved', 'in_transit', 'received', 'inspected'];
export const OPEN_TRIAL_STATUSES = ['requested', 'approved', 'returned'];
export const OPEN_CLAIM_STATUSES = ['submitted', 'under_review', 'approved', 'repair', 'replacement'];

export function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * 24 * 60 * 60 * 1000);
}

export function addYears(at: Date, years: number): Date {
  const next = new Date(at.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

export type WindowState = { ends_at: string; seconds_left: number; open: boolean };

export function windowState(deliveredAt: Date | null, days: number, now: Date): WindowState | null {
  if (deliveredAt === null) return null;
  const endsAt = addDays(deliveredAt, days);
  const secondsLeft = Math.max(0, Math.floor((endsAt.getTime() - now.getTime()) / 1000));
  return { ends_at: endsAt.toISOString(), seconds_left: secondsLeft, open: now.getTime() < endsAt.getTime() };
}

export function holdExpiresAt(reservedAt: Date): Date {
  return new Date(reservedAt.getTime() + config.reservationTtlSeconds * 1000);
}

export function holdActive(reservedAt: Date | null, releasedAt: Date | null, now: Date): boolean {
  if (reservedAt === null || releasedAt !== null) return false;
  return now.getTime() < holdExpiresAt(reservedAt).getTime();
}

export function cardOutcome(number: string): 'authorized' | 'card_declined' | 'insufficient_funds' {
  const digits = number.replace(/\s+/g, '');
  if (digits === '4000000000000002') return 'card_declined';
  if (digits === '4000000000009995') return 'insufficient_funds';
  return 'authorized';
}

export function refundShareFor(
  paidAmount: number,
  quantity: number,
  returnedQuantity: number,
  refundedAmount: number,
  requested: number
): number {
  if (returnedQuantity + requested >= quantity) {
    return paidAmount - refundedAmount;
  }
  return roundHalfUp((paidAmount * requested) / quantity);
}
