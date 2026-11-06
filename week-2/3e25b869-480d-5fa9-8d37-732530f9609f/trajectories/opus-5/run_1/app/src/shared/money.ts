import type { Locale, Money, ProvinceCode, TaxCode, TaxLine } from './types.js';

export const NBSP = '\u00A0';

export const BAR_PRICE_CENTS = 1100;
export const DROP_SHIPPING_CENTS = 900;
export const TRIO_BARS = 3;
export const TRIO_LIST_CENTS = BAR_PRICE_CENTS * TRIO_BARS;

/** Percentages are held in hundred-thousandths, so 9.975% is 9_975. */
export type Rate = number;

export const RATE_SUBSCRIBE_AND_SAVE: Rate = 12_000;

export function money(cents: number): Money {
  return { cents, currency: 'CAD' };
}

/** The only rounding in the shop: half up, in hundred-thousandths. */
export function applyRate(baseCents: number, rate: Rate): number {
  return Math.floor((baseCents * rate + 50_000) / 100_000);
}

type TaxSpec = { code: TaxCode; rate: Rate; label: string };

const GST: TaxSpec = { code: 'GST', rate: 5_000, label: '5%' };
const QST: TaxSpec = { code: 'QST', rate: 9_975, label: '9.975%' };
const HST13: TaxSpec = { code: 'HST', rate: 13_000, label: '13%' };
const HST14: TaxSpec = { code: 'HST', rate: 14_000, label: '14%' };
const HST15: TaxSpec = { code: 'HST', rate: 15_000, label: '15%' };

type ProvinceSpec = { code: ProvinceCode; en: string; fr: string; taxes: readonly TaxSpec[] };

export const PROVINCES: readonly ProvinceSpec[] = [
  { code: 'AB', en: 'Alberta', fr: 'Alberta', taxes: [GST] },
  { code: 'BC', en: 'British Columbia', fr: 'Colombie-Britannique', taxes: [GST] },
  { code: 'MB', en: 'Manitoba', fr: 'Manitoba', taxes: [GST] },
  { code: 'NB', en: 'New Brunswick', fr: 'Nouveau-Brunswick', taxes: [HST15] },
  { code: 'NL', en: 'Newfoundland and Labrador', fr: 'Terre-Neuve-et-Labrador', taxes: [HST15] },
  { code: 'NS', en: 'Nova Scotia', fr: 'Nouvelle-Écosse', taxes: [HST14] },
  { code: 'NT', en: 'Northwest Territories', fr: 'Territoires du Nord-Ouest', taxes: [GST] },
  { code: 'NU', en: 'Nunavut', fr: 'Nunavut', taxes: [GST] },
  { code: 'ON', en: 'Ontario', fr: 'Ontario', taxes: [HST13] },
  { code: 'PE', en: 'Prince Edward Island', fr: 'Île-du-Prince-Édouard', taxes: [HST15] },
  { code: 'QC', en: 'Québec', fr: 'Québec', taxes: [GST, QST] },
  { code: 'SK', en: 'Saskatchewan', fr: 'Saskatchewan', taxes: [GST] },
  { code: 'YT', en: 'Yukon', fr: 'Yukon', taxes: [GST] },
];

export const DEFAULT_PROVINCE: ProvinceCode = 'QC';

const PROVINCE_BY_CODE = new Map(PROVINCES.map((p) => [p.code, p]));

export function isProvinceCode(value: unknown): value is ProvinceCode {
  return typeof value === 'string' && PROVINCE_BY_CODE.has(value as ProvinceCode);
}

export function provinceName(code: ProvinceCode, locale: Locale): string {
  const spec = PROVINCE_BY_CODE.get(code);
  if (!spec) throw new Error(`unknown province ${code}`);
  return locale === 'fr-CA' ? spec.fr : spec.en;
}

export function taxCodeLabel(code: TaxCode, locale: Locale): string {
  if (locale === 'en-CA') return code;
  return code === 'GST' ? 'TPS' : code === 'QST' ? 'TVQ' : 'TVH';
}

export function formatRate(rate: string, locale: Locale): string {
  if (locale === 'en-CA') return rate;
  return `${rate.slice(0, -1).replace('.', ',')}${NBSP}%`;
}

/** Each tax line is its own rate applied to the pre-tax amount; QST never stacks on GST. */
export function taxLinesFor(province: ProvinceCode, preTaxCents: number): TaxLine[] {
  const spec = PROVINCE_BY_CODE.get(province);
  if (!spec) throw new Error(`unknown province ${province}`);
  return spec.taxes.map((tax) => ({
    code: tax.code,
    rate: tax.label,
    amount: money(applyRate(preTaxCents, tax.rate)),
  }));
}

const RATE_BY_LABEL = new Map<string, Rate>(
  [GST, QST, HST13, HST14, HST15].map((tax) => [tax.label, tax.rate]),
);

export function rateValue(label: string): Rate {
  const rate = RATE_BY_LABEL.get(label);
  if (rate === undefined) throw new Error(`unknown rate ${label}`);
  return rate;
}

export function sumTaxes(taxes: readonly TaxLine[]): number {
  return taxes.reduce((total, line) => total + line.amount.cents, 0);
}

export type PriceBreakdown = {
  subtotal: Money;
  discount: Money;
  pre_tax: Money;
  shipping_fee: Money;
  taxes: TaxLine[];
  total: Money;
};

function priceOf(
  subtotalCents: number,
  discountRate: Rate | null,
  shippingCents: number,
  province: ProvinceCode,
): PriceBreakdown {
  const discount = discountRate === null ? 0 : applyRate(subtotalCents, discountRate);
  const preTax = subtotalCents - discount + shippingCents;
  const taxes = taxLinesFor(province, preTax);
  return {
    subtotal: money(subtotalCents),
    discount: money(discount),
    pre_tax: money(preTax),
    shipping_fee: money(shippingCents),
    taxes,
    total: money(preTax + sumTaxes(taxes)),
  };
}

export function dropOrderPrice(barCount: number, province: ProvinceCode): PriceBreakdown {
  const shipping = barCount === 0 ? 0 : DROP_SHIPPING_CENTS;
  return priceOf(barCount * BAR_PRICE_CENTS, null, shipping, province);
}

export function trioPrice(province: ProvinceCode): PriceBreakdown {
  return priceOf(TRIO_LIST_CENTS, RATE_SUBSCRIBE_AND_SAVE, 0, province);
}

function groupThousands(digits: string, separator: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += separator;
    out += digits[i];
  }
  return out;
}

export function formatMoney(value: Money, locale: Locale): string {
  const negative = value.cents < 0;
  const abs = Math.abs(value.cents);
  const whole = groupThousands(String(Math.floor(abs / 100)), locale === 'fr-CA' ? NBSP : ',');
  const fraction = String(abs % 100).padStart(2, '0');
  if (locale === 'fr-CA') return `${negative ? '-' : ''}${whole},${fraction}${NBSP}$`;
  return `${negative ? '-' : ''}$${whole}.${fraction}`;
}

export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function parseDollarAmount(text: string): number | null {
  if (!/^-?\d{1,7}([.,]\d{1,2})?$/.test(text.trim())) return null;
  const normalised = text.trim().replace(',', '.');
  const [whole, fraction = ''] = normalised.split('.');
  const sign = normalised.startsWith('-') ? -1 : 1;
  const wholeCents = Math.abs(Number(whole)) * 100;
  const fractionCents = Number(fraction.padEnd(2, '0') || '0');
  return sign * (wholeCents + fractionCents);
}
