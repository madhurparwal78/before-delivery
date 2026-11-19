import { SIZE_FORM_MESSAGE, SIZE_FR_MINIMUM_MESSAGE, SIZE_ORDER_MESSAGE, SIZE_RANGE_MESSAGE } from './messages.js';

type SizeUnit = 'fr' | 'px' | '%' | 'auto' | 'minmax';
type RangedUnit = 'fr' | 'px' | '%';
type SimpleUnit = RangedUnit | 'auto';

interface Simple {
  unit: SimpleUnit;
  value: number;
  text: string;
}

type SizeResult = { ok: true; size: string } | { ok: false; message: string };

const RANGES: Record<RangedUnit, [number, number]> = {
  fr: [0.25, 100],
  px: [1, 4000],
  '%': [1, 100],
};
const STEPS: Record<RangedUnit, number> = { fr: 0.25, px: 10, '%': 1 };

const FRACTIONAL = /^(\d+(?:\.\d{1,2})?)(fr|%)$/;
const WHOLE = /^(\d+)px$/;

function parseSimple(text: string): Simple | null {
  if (text === 'auto') return { unit: 'auto', value: 0, text };
  const whole = WHOLE.exec(text);
  if (whole) return { unit: 'px', value: Number(whole[1]), text: `${Number(whole[1])}px` };
  const fractional = FRACTIONAL.exec(text);
  if (fractional) {
    const unit = fractional[2] === 'fr' ? 'fr' : '%';
    return { unit, value: Number(fractional[1]), text: `${Number(fractional[1])}${unit}` };
  }
  return null;
}

const inRange = (part: Simple): boolean =>
  part.unit === 'auto' || (part.value >= RANGES[part.unit][0] && part.value <= RANGES[part.unit][1]);

export function parseSize(input: string): SizeResult {
  const text = input.trim();
  const wrapped = /^minmax\(\s*([^,()\s]+)\s*,\s*([^,()\s]+)\s*\)$/.exec(text);
  const parts: Simple[] = [];
  for (const piece of wrapped ? [wrapped[1], wrapped[2]] : [text]) {
    const part = parseSimple(piece);
    if (!part) return { ok: false, message: SIZE_FORM_MESSAGE };
    parts.push(part);
  }
  const [first, second] = parts;
  if (!wrapped) return inRange(first) ? { ok: true, size: first.text } : { ok: false, message: SIZE_RANGE_MESSAGE };
  if (!inRange(first) || !inRange(second)) return { ok: false, message: SIZE_RANGE_MESSAGE };
  if (first.unit === 'fr') return { ok: false, message: SIZE_FR_MINIMUM_MESSAGE };
  if (first.unit === second.unit && first.unit !== 'auto' && first.value > second.value) {
    return { ok: false, message: SIZE_ORDER_MESSAGE };
  }
  return { ok: true, size: `minmax(${first.text}, ${second.text})` };
}

export function sizeUnit(size: string): SizeUnit {
  if (size.startsWith('minmax(')) return 'minmax';
  if (size === 'auto') return 'auto';
  return size.endsWith('fr') ? 'fr' : size.endsWith('px') ? 'px' : '%';
}

/** The unit of a size a separator can move (fr, px, %); null for auto and minmax. */
function rangedUnit(size: string): RangedUnit | null {
  const unit = sizeUnit(size);
  return unit === 'auto' || unit === 'minmax' ? null : unit;
}

/** The smallest and largest value a separator can give the size. */
export function rangeOf(size: string): [number, number] | null {
  const unit = rangedUnit(size);
  return unit && RANGES[unit];
}

/** The size one separator step away, or null when the track cannot move that way (auto, minmax, range edge). */
export function stepSize(size: string, direction: 1 | -1): string | null {
  const unit = rangedUnit(size);
  if (!unit) return null;
  const [low, high] = RANGES[unit];
  const next = Number(size.slice(0, -unit.length)) + direction * STEPS[unit];
  return next < low || next > high ? null : `${next}${unit}`;
}
