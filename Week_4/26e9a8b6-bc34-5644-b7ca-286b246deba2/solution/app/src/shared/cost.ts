import type { Currency } from './types';

interface CostedPart { quantity: number; unit_price: number; fitted_at: string | null }

const symbols: Record<Currency, string> = { EUR: '€', GBP: '£', USD: '$', JPY: '¥' };

/** Running parts cost after step `stepNumber` (1-based; 0 means before any step): parts fitted at or before it. */
export function runningCost(parts: readonly CostedPart[], stepIds: readonly string[], stepNumber: number): number {
  const fitted = new Set(stepIds.slice(0, stepNumber));
  let total = 0;
  for (const part of parts) if (part.fitted_at !== null && fitted.has(part.fitted_at)) total += part.quantity * part.unit_price;
  return total;
}

export function guideTotal(parts: readonly CostedPart[], stepIds: readonly string[]): number {
  return runningCost(parts, stepIds, stepIds.length);
}

function grouped(whole: number): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatCost(minor: number, currency: Currency): string {
  const sign = minor < 0 ? '-' : '';
  const amount = Math.abs(Math.round(minor));
  if (currency === 'JPY') return `${sign}${symbols.JPY}${grouped(amount)}`;
  return `${sign}${symbols[currency]}${grouped(Math.floor(amount / 100))}.${String(amount % 100).padStart(2, '0')}`;
}

export function formatCostDifference(minor: number, currency: Currency): string {
  const text = formatCost(Math.abs(minor), currency);
  return `${minor < 0 ? '-' : '+'}${text}`;
}

export function formatCount(value: number): string {
  return grouped(Math.round(value));
}
