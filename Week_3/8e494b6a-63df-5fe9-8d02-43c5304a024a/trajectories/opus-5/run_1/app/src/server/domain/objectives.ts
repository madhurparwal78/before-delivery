import { fixed } from './numbers.js';

export const LONG_WINDOW_MS = 3600000;
export const SHORT_WINDOW_MS = 300000;

export type WindowCounts = { bad: number; total: number };

export type ObjectiveStatus = 'OK' | 'Burning' | 'Burning fast';

export function errorBudget(target: number): number {
  return 1 - target / 100;
}

/** budget remaining = 1 - (bad / total) / budget, as a percentage with 2 decimals. */
export function budgetRemaining(counts: WindowCounts, target: number): string {
  if (counts.total === 0) return '100.00';
  const used = counts.bad / counts.total / errorBudget(target);
  return fixed((1 - used) * 100, 2);
}

export function burnRate(counts: WindowCounts, target: number): string {
  if (counts.total === 0) return '0.00';
  return fixed(counts.bad / counts.total / errorBudget(target), 2);
}

export function objectiveStatus(longBurn: string, shortBurn: string): ObjectiveStatus {
  const long = Number(longBurn);
  const short = Number(shortBurn);
  if (long >= 14.4 && short >= 14.4) return 'Burning fast';
  if (long >= 6 && short >= 6) return 'Burning';
  return 'OK';
}
