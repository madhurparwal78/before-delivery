/**
 * The one conversion from stored whole millimetres to the shown strings.
 * Both the editor Inspector and the build-pack page read these functions.
 */

export interface Length {
  mm: number;
  m: string;
  ft: string;
}

export type Units = 'm' | 'ft';

/** Metres: mm / 1000 with exactly three decimals, by integer arithmetic. */
export function metres(mm: number): string {
  const sign = mm < 0 ? '-' : '';
  const abs = Math.abs(mm);
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}

function reduceSixteenths(numerator: number): string {
  let n = numerator;
  let d = 16;
  while (n % 2 === 0 && d % 2 === 0) {
    n /= 2;
    d /= 2;
  }
  return `${n}/${d}`;
}

/** Feet, inches and reduced sixteenths, worked out in whole sixteenths of an inch. */
export function feetInches(mm: number): string {
  const sixteenths = Math.floor((mm * 160 + 127) / 254);
  const feet = Math.floor(sixteenths / 192);
  const rest = sixteenths % 192;
  const inches = Math.floor(rest / 16);
  const frac = rest % 16;
  const inchText = frac === 0 ? `${inches}` : `${inches} ${reduceSixteenths(frac)}`;
  return `${feet}' ${inchText}"`;
}

export function length(mm: number): Length {
  return { mm, m: metres(mm), ft: feetInches(mm) };
}

export function lengthText(mm: number, units: Units): string {
  return units === 'ft' ? feetInches(mm) : metres(mm);
}

export function normaliseUnits(raw: string | null | undefined): Units {
  return raw === 'ft' ? 'ft' : 'm';
}

/** Metre input with up to three decimals, as whole millimetres. */
export function parseMetresToMm(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return null;
  const [whole, decimals = ''] = text.split('.');
  return Number(whole) * 1000 + Number(decimals.padEnd(3, '0'));
}
