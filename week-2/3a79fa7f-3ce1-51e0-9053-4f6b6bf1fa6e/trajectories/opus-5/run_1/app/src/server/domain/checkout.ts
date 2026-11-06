import { roundHalfUp } from '../money.js';
import { boardPackage, type BoardName } from './catalog.js';
import { financingFor, type FinancingTerm } from './financing.js';
import { taxRatesFor, type CountryRule } from './countries.js';
import { deliveryDates } from './shipcalendar.js';

export const DEMO_CREDIT_CENTS = 20000;

export interface CheckoutLine {
  id: number;
  type: 'build' | 'accessory';
  code: string | null;
  sku: string;
  name: string;
  quantity: number;
  unit_cents: number;
  line_cents: number;
  board: BoardName | null;
  spares: number;
}

export interface TaxComponentShape {
  name: string;
  rate_pcm: number;
  amount_cents: number;
}

export interface CreditShape {
  kind: 'trade_in' | 'demo';
  amount_cents: number;
}

export interface Breakdown {
  lines: CheckoutLine[];
  subtotal_cents: number;
  discounts: { code: string; amount_cents: number }[];
  credits: CreditShape[];
  taxable_cents: number;
  shipping_cents: number;
  free_shipping: boolean;
  packed_batteries: number;
  standalone_batteries: number;
  dangerous_goods_cents: number;
  taxes: TaxComponentShape[];
  tax_cents: number;
  total_cents: number;
  ships_on: string;
  arrives_on: string;
  financing: FinancingTerm[];
}

export interface CheckoutInput {
  lines: CheckoutLine[];
  discounts: { code: string; amount_cents: number }[];
  country: CountryRule;
  postalCode: string | null;
  tradeInCents: number | null;
  demoCredit: boolean;
  at: Date;
}

export function toCheckoutLine(line: {
  id: number;
  type: 'build' | 'accessory';
  code: string | null;
  sku: string;
  name: string;
  quantity: number;
  unit_cents: number;
  line_cents: number;
}, spares: number): CheckoutLine {
  const pkg = line.type === 'build' ? boardPackage(line.sku) : undefined;
  return { ...line, board: pkg ? pkg.board : null, spares };
}

function pickLine(candidates: CheckoutLine[], remaining: Map<number, number>): CheckoutLine | null {
  let best: CheckoutLine | null = null;
  for (const line of candidates) {
    const left = remaining.get(line.id) ?? 0;
    if (left <= 0) continue;
    const bestLeft = best ? (remaining.get(best.id) ?? 0) : -1;
    if (!best || left > bestLeft) best = line;
  }
  return best;
}

export function computeBreakdown(input: CheckoutInput): Breakdown {
  const { lines, discounts, country, postalCode, tradeInCents, demoCredit, at } = input;
  const subtotal = lines.reduce((sum, l) => sum + l.line_cents, 0);
  const discountTotal = discounts.reduce((sum, d) => sum + d.amount_cents, 0);

  const remaining = new Map(lines.map((l) => [l.id, l.line_cents]));
  const buildLines = lines.filter((l) => l.type === 'build');
  const credits: CreditShape[] = [];

  if (tradeInCents !== null) {
    const crestLines = buildLines.filter((l) => l.board === 'Crest');
    const target = pickLine(crestLines, remaining);
    const amount = target ? Math.min(tradeInCents, remaining.get(target.id) ?? 0) : 0;
    if (target) remaining.set(target.id, (remaining.get(target.id) ?? 0) - amount);
    credits.push({ kind: 'trade_in', amount_cents: amount });
  }

  if (demoCredit) {
    const target = pickLine(buildLines, remaining);
    const amount = target ? Math.min(DEMO_CREDIT_CENTS, remaining.get(target.id) ?? 0) : 0;
    if (target) remaining.set(target.id, (remaining.get(target.id) ?? 0) - amount);
    credits.push({ kind: 'demo', amount_cents: amount });
  }

  const creditTotal = credits.reduce((sum, c) => sum + c.amount_cents, 0);
  const taxable = subtotal - discountTotal - creditTotal;

  const hasBuildLine = buildLines.length > 0;
  const baseShipping = hasBuildLine ? country.packageShippingCents : country.accessoryShippingCents;
  const threshold = country.freeAccessoryShippingFromCents;
  const freeShipping = threshold !== null && taxable >= threshold;
  const shipping = freeShipping ? 0 : baseShipping;

  const packedBatteries = buildLines.reduce((sum, l) => sum + l.spares * l.quantity, 0);
  const standaloneBatteries = lines
    .filter((l) => l.type === 'accessory' && l.sku.startsWith('BAT-'))
    .reduce((sum, l) => sum + l.quantity, 0);
  const dangerousGoods =
    packedBatteries * country.packedBatteryFeeCents + standaloneBatteries * country.standaloneBatteryFeeCents;

  const taxes = taxComponents(taxable, country, postalCode);
  const taxTotal = taxes.reduce((sum, t) => sum + t.amount_cents, 0);
  const total = taxable + shipping + dangerousGoods + taxTotal;
  const dates = deliveryDates(country, at);

  return {
    lines,
    subtotal_cents: subtotal,
    discounts,
    credits,
    taxable_cents: taxable,
    shipping_cents: shipping,
    free_shipping: freeShipping,
    packed_batteries: packedBatteries,
    standalone_batteries: standaloneBatteries,
    dangerous_goods_cents: dangerousGoods,
    taxes,
    tax_cents: taxTotal,
    total_cents: total,
    ships_on: dates.ships_on,
    arrives_on: dates.arrives_on,
    financing: financingFor(total, country.code),
  };
}

/** Each tax component is rounded half up on its own. */
export function taxComponents(
  amountCents: number,
  country: CountryRule,
  postalCode: string | null,
): TaxComponentShape[] {
  return taxRatesFor(country, postalCode).map((rate) => ({
    name: rate.name,
    rate_pcm: rate.rate_pcm,
    amount_cents: Number(roundHalfUp(BigInt(amountCents) * BigInt(rate.rate_pcm), 100000n)),
  }));
}
