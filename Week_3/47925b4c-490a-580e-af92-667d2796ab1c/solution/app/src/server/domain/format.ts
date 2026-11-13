import { roundToScale, roundWholeHalfEven } from './round.js';

export function oneDecimal(value: number): string {
  return roundToScale(value, 1).toFixed(1);
}

export function threeDecimals(value: number): string {
  return roundToScale(value, 3).toFixed(3);
}

export function wholeNumber(value: number): string {
  return String(roundWholeHalfEven(value));
}

export function euros(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const body = `€ ${Math.floor(absolute / 100)},${String(absolute % 100).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}
