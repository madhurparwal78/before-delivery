import {
  SIZE_FORM_MESSAGE,
  SIZE_FR_MIN_MESSAGE,
  SIZE_ORDER_MESSAGE,
  SIZE_RANGE_MESSAGE,
} from './messages.js';

export type TrackUnit = 'fr' | 'px' | '%' | 'auto' | 'minmax';

interface SimpleSize {
  unit: 'fr' | 'px' | '%' | 'auto';
  value: number;
}

export type SizeCheck = { ok: true; canonical: string; unit: TrackUnit } | { ok: false; message: string };

const FR = /^(\d+(?:\.\d{1,2})?)fr$/;
const PX = /^(\d+)px$/;
const PERCENT = /^(\d+(?:\.\d{1,2})?)%$/;
const MINMAX = /^minmax\(([^()]*)\)$/;

function parseSimple(text: string): SimpleSize | null {
  if (text === 'auto') return { unit: 'auto', value: 0 };
  const fr = FR.exec(text);
  if (fr) return { unit: 'fr', value: Number(fr[1]) };
  const px = PX.exec(text);
  if (px) return { unit: 'px', value: Number(px[1]) };
  const pct = PERCENT.exec(text);
  if (pct) return { unit: '%', value: Number(pct[1]) };
  return null;
}

function inRange(size: SimpleSize): boolean {
  switch (size.unit) {
    case 'auto':
      return true;
    case 'fr':
      return size.value >= 0.25 && size.value <= 100;
    case 'px':
      return size.value >= 1 && size.value <= 4000;
    case '%':
      return size.value >= 1 && size.value <= 100;
  }
}

function canonicalSimple(size: SimpleSize): string {
  if (size.unit === 'auto') return 'auto';
  return `${String(size.value)}${size.unit}`;
}

/** The single decision on whether a track size is allowed and how it is written. */
export function checkTrackSize(raw: string): SizeCheck {
  const text = raw.trim();
  const minmax = MINMAX.exec(text);
  if (minmax) {
    const parts = (minmax[1] ?? '').split(',');
    if (parts.length !== 2) return { ok: false, message: SIZE_FORM_MESSAGE };
    const min = parseSimple((parts[0] ?? '').trim());
    const max = parseSimple((parts[1] ?? '').trim());
    if (!min || !max) return { ok: false, message: SIZE_FORM_MESSAGE };
    if (!inRange(min) || !inRange(max)) return { ok: false, message: SIZE_RANGE_MESSAGE };
    if (min.unit === 'fr') return { ok: false, message: SIZE_FR_MIN_MESSAGE };
    if (min.unit === max.unit && (min.unit === 'px' || min.unit === '%') && min.value > max.value) {
      return { ok: false, message: SIZE_ORDER_MESSAGE };
    }
    return {
      ok: true,
      canonical: `minmax(${canonicalSimple(min)}, ${canonicalSimple(max)})`,
      unit: 'minmax',
    };
  }
  const simple = parseSimple(text);
  if (!simple) return { ok: false, message: SIZE_FORM_MESSAGE };
  if (!inRange(simple)) return { ok: false, message: SIZE_RANGE_MESSAGE };
  return { ok: true, canonical: canonicalSimple(simple), unit: simple.unit };
}

export function trackUnitOf(canonical: string): TrackUnit {
  const check = checkTrackSize(canonical);
  return check.ok ? check.unit : 'auto';
}

/** Splits a `grid-template-columns` value into its track sizes, keeping `minmax(...)` whole. */
export function splitTrackList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth === 0 && /\s/.test(char)) {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}
