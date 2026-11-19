import { Decimal, dec } from './decimal';

const SUPERSCRIPT: Record<string, string> = {
  '0': '\u2070',
  '1': '\u00b9',
  '2': '\u00b2',
  '3': '\u00b3',
  '4': '\u2074',
  '5': '\u2075',
  '6': '\u2076',
  '7': '\u2077',
  '8': '\u2078',
  '9': '\u2079',
  '-': '\u207b',
};

const SCIENTIFIC_BELOW = new Decimal('0.001');

function superscript(text: string): string {
  return [...text].map((c) => SUPERSCRIPT[c] ?? c).join('');
}

/** Comma grouping on the integer part only. */
export function group(fixed: string): string {
  const negative = fixed.startsWith('-');
  const body = negative ? fixed.slice(1) : fixed;
  const dot = body.indexOf('.');
  const whole = dot === -1 ? body : body.slice(0, dot);
  const rest = dot === -1 ? '' : body.slice(dot);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '\u2212' : ''}${grouped}${rest}`;
}

/**
 * The published display rule: an exact decimal shown to 3 significant figures,
 * half up on the exact value, with comma grouping, trailing zeros kept, exactly
 * 0 shown as `0`, and an exact value under 0.001 shown in powers of ten.
 */
export function shownFigure(value: Decimal | string): string {
  const exact = dec(value);
  if (exact.isZero()) return '0';
  const magnitude = exact.abs();
  if (magnitude.lessThan(SCIENTIFIC_BELOW)) {
    const exponent = magnitude.e;
    const mantissa = exact.times(new Decimal(10).pow(-exponent)).toSignificantDigits(3, Decimal.ROUND_HALF_UP);
    return `${mantissa.toFixed(2 - mantissa.e)} \u00d7 10${superscript(String(exponent))}`;
  }
  const rounded = exact.toSignificantDigits(3, Decimal.ROUND_HALF_UP);
  const decimals = Math.max(0, 2 - rounded.e);
  return group(rounded.toFixed(decimals));
}

export function shownWithUnit(value: Decimal | string, unit: string): string {
  return `${shownFigure(value)} ${unit}`;
}

/** A mass in grams, half up to 0.1 g, as in `247.3 g`. */
export function shownMass(massGrams: Decimal): string {
  return `${group(massGrams.toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1))} g`;
}

/** A stage's share of the exact total in percent, half up to one decimal. */
export function sharePercent(stage: Decimal, total: Decimal): string {
  if (total.isZero()) return '0.0';
  return stage.dividedBy(total).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1);
}

/** A whole number with comma grouping, as in `1,240`. */
export function shownWhole(value: number): string {
  return group(String(value));
}

/**
 * A scenario difference: a true minus sign or an explicit plus, 3 significant
 * figures half up on the size of the difference, and a whole percent of the
 * baseline half up on its size.
 */
export function shownDifference(scenario: Decimal, baseline: Decimal, unit: string): string {
  const difference = scenario.minus(baseline);
  if (difference.isZero()) return 'no change';
  const sign = difference.isNegative() ? '\u2212' : '+';
  const size = shownFigure(difference.abs());
  if (baseline.isZero()) return `${sign}${size} ${unit}`;
  const percent = difference
    .dividedBy(baseline)
    .times(100)
    .abs()
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toFixed(0);
  return `${sign}${size} ${unit} (${sign}${percent}%)`;
}
