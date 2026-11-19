export const DEFAULT_TAX_PERCENT = '8.75';
const MAX_TAX_PERCENT_HUNDREDTHS = 3000;

/** Hundredths of a percent, so `9.25` reads as 925. */
export function taxPercentHundredths(percent: string): number {
  const parts = percent.split('.');
  const whole = Number.parseInt(parts[0], 10);
  const fraction = Number.parseInt((parts[1] ?? '').padEnd(2, '0') || '0', 10);
  return whole * 100 + fraction;
}

/** Always two decimals, as `9.25%`. */
export function formatTaxPercent(percent: string): string {
  const hundredths = taxPercentHundredths(percent);
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}%`;
}

export function isTaxPercentText(value: string): boolean {
  const text = value.trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return false;
  return taxPercentHundredths(text) <= MAX_TAX_PERCENT_HUNDREDTHS;
}
