/**
 * Display rounding. Every numeral Tracewell shows comes from here, rounded half
 * away from zero straight from the stored 18-digit value.
 */
import { Decimal, toFixed, withCommas } from './decimal';

export type DisplayFormat = 'eth' | 'eth-per-1000' | 'mnav' | 'usd' | 'shares';

export function formatDisplay(value: Decimal, format: DisplayFormat): string {
  switch (format) {
    case 'eth':
      return `${withCommas(toFixed(value, 3))} ETH`;
    case 'eth-per-1000':
      return withCommas(toFixed(value, 4));
    case 'mnav':
      return `${withCommas(toFixed(value, 3))}\u00d7`;
    case 'usd':
      return `$${withCommas(toFixed(value, 2))}`;
    case 'shares':
      return withCommas(toFixed(value, 0));
  }
}
