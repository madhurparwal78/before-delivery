import type { ChainFigures } from './types.js';

/** mm -> exactly three decimals, e.g. 2400 -> "2.400". */
export function metres(mm: number): string {
  return (mm / 1000).toFixed(3);
}

/**
 * mm -> feet, inches and reduced sixteenths, integer arithmetic only.
 * s = floor((mm*160+127)/254); feet = s div 192; r = s mod 192;
 * inches = r div 16; fraction (r mod 16)/16 reduced to lowest terms.
 */
export function feetInches(mm: number): string {
  const s = Math.floor((mm * 160 + 127) / 254);
  const feet = Math.floor(s / 192);
  const r = s % 192;
  const inches = Math.floor(r / 16);
  const num = r % 16;
  let frac = '';
  if (num > 0) {
    let x = num;
    let y = 16;
    while (y !== 0) {
      const t = x % y;
      x = y;
      y = t;
    }
    frac = ` ${num / x}/${16 / x}`;
  }
  return `${feet}' ${inches}${frac}"`;
}

export type Unit = 'm' | 'ft';

/** The one length string for the current units (identical on Inspector and pack). */
export function lengthStr(mm: number, unit: Unit): string {
  return unit === 'm' ? metres(mm) : feetInches(mm);
}

export type LengthJson = { mm: number; m: string; ft: string };

export function lengthJson(mm: number): LengthJson {
  return { mm, m: metres(mm), ft: feetInches(mm) };
}

export function figures({ solved, total, longestRun, props }: ChainFigures): string {
  return `${solved} of ${total} solved · Longest run ${longestRun} · ${props === 1 ? '1 prop' : `${props} props`}`;
}

export function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** mm:ss with padded minutes. */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

/** m:ss with unpadded minutes. */
export function mss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${two(s % 60)}`;
}
