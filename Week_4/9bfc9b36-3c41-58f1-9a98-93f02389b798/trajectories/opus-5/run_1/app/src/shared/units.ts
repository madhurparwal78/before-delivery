/**
 * The one place where lengths, areas and money are converted, rounded and grouped.
 * Everything is integer arithmetic: no floating-point value rounds a published figure.
 */

/** Divides two integers, rounding half away from zero. */
export function roundHalfAwayDiv(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (2n * n + d) / (2n * d);
  return negative ? -quotient : quotient;
}

/** Rounds a rational to a whole number, half away from zero. */
export function roundHalfAway(numerator: bigint, denominator: bigint): number {
  return Number(roundHalfAwayDiv(numerator, denominator));
}

const MM_PER_INCH_NUM = 254n; // 25.4 mm, scaled by 10
const MM2_PER_FT2_NUM = 9290304n; // 92 903.04 mm², scaled by 100

/** Renders an integer number of hundredths as a two-decimal string, ungrouped. */
export function formatHundredths(hundredths: bigint): string {
  const negative = hundredths < 0n;
  const absolute = negative ? -hundredths : hundredths;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  return `${negative ? '-' : ''}${whole}.${fraction.toString().padStart(2, '0')}`;
}

export function inchesHundredths(mm: number): bigint {
  return roundHalfAwayDiv(BigInt(mm) * 1000n, MM_PER_INCH_NUM);
}

export function squareMetreHundredths(mm2: number | bigint): bigint {
  return roundHalfAwayDiv(BigInt(mm2) * 100n, 1000000n);
}

export function squareFootHundredths(mm2: number | bigint): bigint {
  return roundHalfAwayDiv(BigInt(mm2) * 10000n, MM2_PER_FT2_NUM);
}

/** Inches of a millimetre figure, to two decimals. */
export function inches(mm: number): string {
  return formatHundredths(inchesHundredths(mm));
}

/** Square metres of a square-millimetre figure, to two decimals. */
export function squareMetres(mm2: number | bigint): string {
  return formatHundredths(squareMetreHundredths(mm2));
}

/** Square feet of a square-millimetre figure, to two decimals. */
export function squareFeet(mm2: number | bigint): string {
  return formatHundredths(squareFootHundredths(mm2));
}

/** Pounds of a pence figure, to two decimals. */
export function pounds(pence: number): string {
  return formatHundredths(BigInt(pence));
}

/**
 * Screen grouping: an integer part of 1000 or more is grouped in threes
 * with one ordinary space. The API and the CSV never group.
 */
export function group(figure: string): string {
  const sign = figure.startsWith('-') || figure.startsWith('+') ? figure.slice(0, 1) : '';
  const rest = sign === '' ? figure : figure.slice(1);
  const point = rest.indexOf('.');
  const whole = point === -1 ? rest : rest.slice(0, point);
  const tail = point === -1 ? '' : rest.slice(point);
  if (whole.length <= 3) return `${sign}${whole}${tail}`;
  const parts: string[] = [];
  for (let end = whole.length; end > 0; end -= 3) {
    parts.unshift(whole.slice(Math.max(0, end - 3), end));
  }
  return `${sign}${parts.join('\u0020')}${tail}`;
}

/** A whole number of millimetres as shown on a screen. */
export function groupedWhole(value: number): string {
  return group(String(value));
}

/** A square-millimetre difference with an explicit sign, grouped for the screen. */
export function signedSquareMillimetres(value: number): string {
  return group(`${value > 0 ? '+' : '-'}${Math.abs(value)}`);
}

/** `<mm> mm (<in> in)` as shown on every screen and in the cut sheet. */
export function pairedLength(mm: number): string {
  return `${groupedWhole(mm)} mm (${group(inches(mm))} in)`;
}

/** `<m²> m² (<ft²> ft²)` as shown on every screen and in the cut sheet. */
export function pairedArea(mm2: number | bigint): string {
  return `${group(squareMetres(mm2))} m² (${group(squareFeet(mm2))} ft²)`;
}

/** `£<£>` as shown on every screen. */
export function pairedMoney(pence: number): string {
  return `£${group(pounds(pence))}`;
}
