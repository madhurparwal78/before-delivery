export type Units = 'm' | 'ft';

export interface Length {
  mm: number;
  m: string;
  ft: string;
}

/** Metres: mm / 1000 with exactly three decimals. */
function metres(mm: number): string {
  return `${Math.floor(mm / 1000)}.${String(mm % 1000).padStart(3, '0')}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Feet, inches and reduced sixteenths, by integer arithmetic only: round(mm * 80 / 127), halves up. */
function feet(mm: number): string {
  const sixteenths = Math.floor((mm * 160 + 127) / 254);
  const wholeFeet = Math.floor(sixteenths / 192);
  const rest = sixteenths % 192;
  const inches = Math.floor(rest / 16);
  const fraction = rest % 16;
  if (fraction === 0) return `${wholeFeet}' ${inches}"`;
  const divisor = gcd(fraction, 16);
  return `${wholeFeet}' ${inches} ${fraction / divisor}/${16 / divisor}"`;
}

export function lengthOf(mm: number): Length {
  return { mm, m: metres(mm), ft: feet(mm) };
}

export function lengthIn(mm: number, units: Units): string {
  return units === 'ft' ? feet(mm) : metres(mm);
}

/** Parses metre input with up to three decimals into whole millimetres, or null when it is not such a number. */
export function parseMetres(text: string): number | null {
  const match = /^\s*(\d+)(?:[.,](\d{1,3}))?\s*$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
}
