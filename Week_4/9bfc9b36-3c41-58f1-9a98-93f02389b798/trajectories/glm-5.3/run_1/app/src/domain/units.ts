import { divPow2, mulHalf } from './int.ts';

export const IN_PER_MM_NUM = 254;
export const IN_PER_MM_DEN = 10000; // 1 inch = 254/10000 mm
export const FT2_PER_MM2_DEN = 9290304; // 1 ft2 = 9290304/100 mm2, so ft2 hundredths use 92903
export const MM2_PER_M2 = 1_000_000;

/** mm -> inches, two decimals, half away from zero (exact integer arithmetic). */
export function mmToInch2(mm: number): string {
  return format2(mulHalf(mm, 1000, 254));
}

/** mm2 -> m2, two decimals. */
export function mm2ToM2(mm2: number): string {
  return format2(mulHalf(mm2, 100, 1_000_000));
}

/** mm2 -> ft2, two decimals. */
export function mm2ToFt2(mm2: number): string {
  return format2(mulHalf(mm2, 100, 92903));
}

/** pence -> pounds, two decimals. */
export function penceToPounds(pence: number): string {
  return format2(mulHalf(pence, 100, 100));
}

export function format2(valueHundredths: number): string {
  const neg = valueHundredths < 0 ? '-' : '';
  const a = Math.abs(valueHundredths);
  const whole = Math.trunc(a / 100);
  const frac = a % 100;
  return `${neg}${whole}.${frac < 10 ? '0' : ''}${frac}`;
}

/** Screen grouping: integer part of 1000 or more grouped in threes with one ordinary space. */
export function groupInteger(text: string): string {
  const neg = text.startsWith('-');
  const body = neg ? text.slice(1) : text;
  const [i, f] = body.split('.');
  if (i.length < 4) return neg ? `-${body}` : body;
  let grouped = '';
  for (let k = 0; k < i.length; k++) grouped = (k > 0 && (i.length - k) % 3 === 0 ? grouped + ' ' : grouped) + i[k];
  return (neg ? '-' : '') + grouped + (f !== undefined ? '.' + f : '');
}

export function screenFig2(valueHundredths: number): string {
  return groupInteger(format2(valueHundredths));
}

/** Screen rendering of a derived figure from its hundredths. API strings never group. */
export function screenInches(mm: number): string {
  return screenFig2(mulHalf(mm, 1000, 254));
}
export function screenM2(mm2: number): string {
  return screenFig2(mulHalf(mm2, 100, 1_000_000));
}
export function screenFt2(mm2: number): string {
  return screenFig2(mulHalf(mm2, 100, 92903));
}
export function screenPounds(pence: number): string {
  return screenFig2(mulHalf(pence, 100, 10000));
}
export function screenMm(mm: number): string {
  return groupInteger(String(mm));
}

export { divPow2 };
