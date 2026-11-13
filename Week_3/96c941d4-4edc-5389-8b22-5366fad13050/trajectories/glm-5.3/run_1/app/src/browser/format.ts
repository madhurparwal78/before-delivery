// Formatting helpers shared by all views (single conversion source in shared/numeric).
import { formatMilliCharge, formatTicks } from '../shared/numeric.js';

export { formatMilliCharge, formatTicks };

export function formatTenthsPercent(tenths: number): string {
  const whole = Math.floor(tenths / 10);
  const frac = (tenths % 10).toString();
  return `${whole}.${frac}%`;
}

export function formatInstantLocal(localTime: string): string {
  return `${localTime.slice(0, 10)} ${localTime.slice(11, 19)} (UTC+05:45)`;
}

export function seasonDayLabel(seasonDay: string): string {
  return seasonDay;
}
