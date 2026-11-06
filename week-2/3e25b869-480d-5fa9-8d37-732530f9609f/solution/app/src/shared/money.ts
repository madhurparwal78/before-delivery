// The shop's one money formula: whole cents, rates in hundred-thousandths, a single half-up rounding.
import { type Locale, type TaxCode, type TaxRate, province } from './catalog.js';

export interface Money {
  cents: number;
  currency: 'CAD';
}

export interface TaxLine {
  code: TaxCode;
  rate: string;
  amount: Money;
}

export const money = (cents: number): Money => ({ cents, currency: 'CAD' });

export const BAR_CENTS = 1100;
export const SHIPPING_CENTS = 900;
const TRIO_BARS = 3;
const TRIO_DISCOUNT_RATE = 12000;

/** floor((base × rate + 50,000) ÷ 100,000): the only rounding in the shop. */
export function applyRate(base: number, rate: number): number {
  return Math.floor((base * rate + 50000) / 100000);
}

function taxLines(provinceCode: string, base: number): TaxLine[] {
  const found = province(provinceCode);
  return (found?.taxes ?? []).map((tax: TaxRate) => ({ code: tax.code, rate: tax.label, amount: money(applyRate(base, tax.rate)) }));
}

interface DropTotals {
  subtotal: Money;
  shipping_fee: Money;
  taxes: TaxLine[];
  total: Money;
}

export function dropTotals(bars: number, provinceCode: string): DropTotals {
  if (bars === 0) return { subtotal: money(0), shipping_fee: money(0), taxes: [], total: money(0) };
  const subtotal = bars * BAR_CENTS;
  const preTax = subtotal + SHIPPING_CENTS;
  const taxes = taxLines(provinceCode, preTax);
  const total = preTax + taxes.reduce((sum, t) => sum + t.amount.cents, 0);
  return { subtotal: money(subtotal), shipping_fee: money(SHIPPING_CENTS), taxes, total: money(total) };
}

interface TrioPrice {
  subtotal: Money;
  discount: Money;
  pre_tax: Money;
  taxes: TaxLine[];
  total: Money;
}

export function trioPrice(provinceCode: string): TrioPrice {
  const subtotal = TRIO_BARS * BAR_CENTS;
  const discount = applyRate(subtotal, TRIO_DISCOUNT_RATE);
  const preTax = subtotal - discount;
  const taxes = taxLines(provinceCode, preTax);
  const total = preTax + taxes.reduce((sum, t) => sum + t.amount.cents, 0);
  return { subtotal: money(subtotal), discount: money(discount), pre_tax: money(preTax), taxes, total: money(total) };
}

const NBSP = ' ';

function groupThousands(whole: number, separator: string): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/** `$1,234.56` / `1 234,56 $`, hyphen-minus for negatives. */
export function formatMoney(cents: number, locale: Locale): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const part = String(abs % 100).padStart(2, '0');
  return locale === 'fr-CA'
    ? `${sign}${groupThousands(whole, NBSP)},${part}${NBSP}$`
    : `${sign}$${groupThousands(whole, ',')}.${part}`;
}

/** `9.975%` / `9,975 %`. */
export function formatRate(rate: string, locale: Locale): string {
  return locale === 'fr-CA' ? `${rate.slice(0, -1).replace('.', ',')}${NBSP}%` : rate;
}

/** Integer cents to the decimal string a Kill Bill body carries. */
export function decimalString(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** A decimal amount's source text from Kill Bill JSON, to integer cents, through its digits only. */
export function centsFromDecimal(text: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(text.trim());
  if (!match) throw new Error(`not a decimal amount: ${text}`);
  const cents = Number(match[2]) * 100 + Number((match[3] ?? '0').padEnd(2, '0'));
  return match[1] === '-' ? -cents : cents;
}
