// The one place that decides track-size validity, range and canonical form.

export type TrackUnit = 'fr' | 'px' | '%' | 'auto' | 'minmax';

export interface TrackSize {
  unit: TrackUnit;
  amount?: number;   // fr, px or %
  min?: TrackSize;    // minmax minimum
  max?: TrackSize;    // minmax maximum
}

export const SIZE_FORM_MESSAGE = 'Use a size like 1fr, 200px, 25%, auto or minmax(100px, 1fr).';
export const SIZE_RANGE_MESSAGE = 'Sizes run from 0.25fr to 100fr, 1px to 4000px and 1% to 100%.';
export const SIZE_MINMAX_FR_MESSAGE = 'A flexible size (fr) can only be the maximum in minmax.';
export const SIZE_MINMAX_ORDER_MESSAGE = 'The minimum is larger than the maximum.';

const TWO_DECIMALS = 2;

/** Reads one size. Returns null when the text is not one of the published forms. */
export function parseTrackSize(text: string): TrackSize | null {
  const raw = text.trim();
  if (raw === 'auto') return { unit: 'auto' };
  const minmaxMatch = /^minmax\s*\((.*)\)$/.exec(raw);
  if (minmaxMatch) {
    const parts = splitTop(minmaxMatch[1] ?? '', ',');
    if (parts.length !== 2) return null;
    const min = parseTrackSize(parts[0] ?? '');
    const max = parseTrackSize(parts[1] ?? '');
    if (!min || !max || min.unit === 'minmax' || max.unit === 'minmax') return null;
    return { unit: 'minmax', min, max };
  }
  const simple = /^(\d+(?:\.\d+)?)(fr|px|%)$/.exec(raw);
  if (!simple) return null;
  const amount = Number(simple[1]);
  if (!Number.isFinite(amount)) return null;
  return { unit: simple[2] as TrackUnit, amount };
}

function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === sep && depth === 0) { parts.push(current); current = ''; }
    else current += ch;
  }
  parts.push(current);
  return parts;
}

function formatAmount(amount: number): string {
  return String(Number(amount.toFixed(TWO_DECIMALS)));
}

/** The canonical form used everywhere a size is shown, stored or generated. */
export function canonicalTrackSize(size: TrackSize): string {
  if (size.unit === 'auto') return 'auto';
  if (size.unit === 'minmax') {
    return `minmax(${canonicalTrackSize(size.min!)}, ${canonicalTrackSize(size.max!)})`;
  }
  return `${formatAmount(size.amount!)}${size.unit}`;
}

/** Checks the parts of one size in the published order. */
function rangeError(part: TrackSize): string | null {
  const amount = part.amount ?? 0;
  if (part.unit === 'fr') {
    if (amount < 0.25 || amount > 100) return SIZE_RANGE_MESSAGE;
  } else if (part.unit === 'px') {
    if (!Number.isInteger(amount) || amount < 1 || amount > 4000) return SIZE_RANGE_MESSAGE;
  } else if (part.unit === '%') {
    if (amount < 1 || amount > 100) return SIZE_RANGE_MESSAGE;
  }
  return null;
}

/** The published checks, in their published order. Returns the first failing message, or null. */
export function trackSizeError(size: TrackSize | null): string | null {
  if (!size) return SIZE_FORM_MESSAGE;
  if (size.unit === 'minmax') {
    const min = size.min!;
    const max = size.max!;
    if (min.unit === 'fr') return SIZE_MINMAX_FR_MESSAGE;
    const minRange = rangeError(min);
    if (minRange) return minRange;
    const maxRange = rangeError(max);
    if (maxRange) return maxRange;
    if (min.unit === 'px' && max.unit === 'px' && (min.amount ?? 0) > (max.amount ?? 0)) return SIZE_MINMAX_ORDER_MESSAGE;
    if (min.unit === '%' && max.unit === '%' && (min.amount ?? 0) > (max.amount ?? 0)) return SIZE_MINMAX_ORDER_MESSAGE;
    return null;
  }
  return rangeError(size);
}

/** The single entry point: parse, check in order and canonicalise. */
export function readTrackSize(text: string): { size?: string; error: string | null } {
  const parsed = parseTrackSize(text);
  const error = trackSizeError(parsed);
  if (error) return { error };
  return { size: canonicalTrackSize(parsed!), error: null };
}
