import { largestRemainder } from './money.js';

export interface RefundOrder {
  lines: { flavour: string; quantity: number; unit_price_cents: number; goods_cents: number; discount_cents: number; deposit_cents: number }[];
  shipping_cents: number;
  taxes: { name: string; rate: string; cents: number }[];
}

export interface RefundSplit {
  lines: { flavour: string; goods_cents: number; deposit_cents: number }[];
  shipping_cents: number;
  taxes: { name: string; cents: number }[];
}

interface Part {
  kind: 'goods' | 'deposit' | 'shipping' | 'tax';
  lineIndex?: number;
  taxIndex?: number;
  remaining: number;
}

function partsOf(order: RefundOrder, refundedSoFar: RefundSplit | null): Part[] {
  const parts: Part[] = [];
  order.lines.forEach((line, i) => {
    const goodsRefunded = refundedSoFar?.lines[i]?.goods_cents ?? 0;
    const depositRefunded = refundedSoFar?.lines[i]?.deposit_cents ?? 0;
    parts.push({ kind: 'goods', lineIndex: i, remaining: line.goods_cents - line.discount_cents - goodsRefunded });
    parts.push({ kind: 'deposit', lineIndex: i, remaining: line.deposit_cents - depositRefunded });
  });
  const shippingRefunded = refundedSoFar?.shipping_cents ?? 0;
  parts.push({ kind: 'shipping', remaining: order.shipping_cents - shippingRefunded });
  order.taxes.forEach((tax, i) => {
    const taxRefunded = refundedSoFar?.taxes[i]?.cents ?? 0;
    parts.push({ kind: 'tax', taxIndex: i, remaining: tax.cents - taxRefunded });
  });
  return parts;
}

export function refundableCents(order: RefundOrder, refundedSoFar: RefundSplit | null): number {
  return partsOf(order, refundedSoFar).reduce((s, p) => s + Math.max(0, p.remaining), 0);
}

export function splitRefund(order: RefundOrder, refundedSoFar: RefundSplit | null, amount: number): RefundSplit {
  const parts = partsOf(order, refundedSoFar);
  const positive = parts.filter((p) => p.remaining > 0);
  const allocation = largestRemainder(
    amount,
    positive.map((p) => ({ index: 0, value: p.remaining }))
  );
  const byPart = new Map<Part, number>();
  positive.forEach((p, i) => byPart.set(p, allocation[i]));

  const split: RefundSplit = {
    lines: order.lines.map((l) => ({ flavour: l.flavour, goods_cents: 0, deposit_cents: 0 })),
    shipping_cents: 0,
    taxes: order.taxes.map((t) => ({ name: t.name, cents: 0 })),
  };
  for (const part of parts) {
    const take = byPart.get(part) ?? 0;
    if (part.kind === 'goods' && part.lineIndex !== undefined) {
      split.lines[part.lineIndex].goods_cents += take;
    } else if (part.kind === 'deposit' && part.lineIndex !== undefined) {
      split.lines[part.lineIndex].deposit_cents += take;
    } else if (part.kind === 'shipping') {
      split.shipping_cents += take;
    } else if (part.kind === 'tax' && part.taxIndex !== undefined) {
      split.taxes[part.taxIndex].cents += take;
    }
  }
  return split;
}

export function mergeRefundedSplits(splits: RefundSplit[]): RefundSplit | null {
  if (splits.length === 0) return null;
  const first = splits[0];
  const merged: RefundSplit = {
    lines: first.lines.map((l) => ({ flavour: l.flavour, goods_cents: 0, deposit_cents: 0 })),
    shipping_cents: 0,
    taxes: first.taxes.map((t) => ({ name: t.name, cents: 0 })),
  };
  for (const s of splits) {
    s.lines.forEach((l, i) => {
      merged.lines[i].goods_cents += l.goods_cents;
      merged.lines[i].deposit_cents += l.deposit_cents;
    });
    merged.shipping_cents += s.shipping_cents;
    s.taxes.forEach((t, i) => {
      merged.taxes[i].cents += t.cents;
    });
  }
  return merged;
}
