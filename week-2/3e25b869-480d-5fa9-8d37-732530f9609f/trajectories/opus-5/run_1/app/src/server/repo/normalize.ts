import { money } from '../../shared/money.js';
import type {
  Money,
  ReconciliationLine,
  ShippingAddress,
  TaxLine,
} from '../../shared/types.js';

/**
 * JSONB does not keep the key order a document was written with, so every stored document is rebuilt
 * in the published order before it leaves the API.
 */
export function orderedMoney(value: Money): Money {
  return { cents: value.cents, currency: value.currency };
}

export function orderedTaxLine(line: TaxLine): TaxLine {
  return { code: line.code, rate: line.rate, amount: orderedMoney(line.amount) };
}

export function orderedTaxLines(lines: readonly TaxLine[]): TaxLine[] {
  return lines.map(orderedTaxLine);
}

export function orderedShipping(address: ShippingAddress): ShippingAddress {
  return {
    name: address.name,
    line1: address.line1,
    city: address.city,
    province: address.province,
    postal_code: address.postal_code,
  };
}

export function orderedBarRef(bar: { batch: string; bar: number }): { batch: string; bar: number } {
  return { batch: bar.batch, bar: bar.bar };
}

export function orderedReconciliationLine(line: ReconciliationLine): ReconciliationLine {
  return {
    key: line.key,
    kind: line.kind,
    shop: line.shop === null ? null : orderedMoney(line.shop),
    killbill: line.killbill === null ? null : orderedMoney(line.killbill),
    status: line.status,
  };
}

export function orderedAttempt(attempt: { at: string; outcome: 'sent' | 'failed' }): {
  at: string;
  outcome: 'sent' | 'failed';
} {
  return { at: attempt.at, outcome: attempt.outcome };
}

export function sumMoney(values: readonly (Money | null)[]): Money {
  return money(values.reduce((total, value) => total + (value?.cents ?? 0), 0));
}
