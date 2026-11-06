import { inchesToCm, roundHalfUp } from '../../shared/format.js';
import type { Board, OfficeId } from '../../shared/types.js';

export const ROSTER_HEADER = [
  'Email',
  'First Name',
  'Last Name',
  'Date of Birth',
  'Office',
  'Division',
  'Height',
  'Chest',
  'Waist',
  'Hips',
  'Instagram',
  'TikTok',
  'YouTube',
];

export function parseHeightValue(raw: string): number | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  const feetInches = /^(\d+)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/.exec(value);
  if (feetInches) {
    const feet = Number(feetInches[1]);
    const inches = feetInches[2] ? Number(feetInches[2]) : 0;
    return inchesToCm(feet * 12 + inches);
  }
  const inchesOnly = /^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/.exec(value);
  if (inchesOnly) return inchesToCm(Number(inchesOnly[1]));
  const centimetres = /^(\d+(?:\.\d+)?)\s*cm$/.exec(value);
  if (centimetres) return roundHalfUp(Number(centimetres[1]));
  const metres = /^(\d+(?:\.\d+)?)\s*m$/.exec(value);
  if (metres) return roundHalfUp(Number(metres[1]) * 100);
  const bare = /^(\d+(?:\.\d+)?)$/.exec(value);
  if (bare) return roundHalfUp(Number(bare[1]));
  return null;
}

export function parseBodyMeasureValue(raw: string): number | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  const inches = /^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/.exec(value);
  if (inches) return inchesToCm(Number(inches[1]));
  const centimetres = /^(\d+(?:\.\d+)?)\s*cm$/.exec(value);
  if (centimetres) return roundHalfUp(Number(centimetres[1]));
  const bare = /^(\d+(?:\.\d+)?)$/.exec(value);
  if (bare) return roundHalfUp(Number(bare[1]));
  return null;
}

export function parseReachValue(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (!/^\d{1,3}(?:,\d{3})*$|^\d+$/.test(value)) return null;
  return Number(value.replace(/,/g, ''));
}

const OFFICE_NAMES: Record<string, OfficeId> = {
  toronto: 'toronto',
  tor: 'toronto',
  vancouver: 'vancouver',
  van: 'vancouver',
};

const DIVISION_NAMES: Record<string, Board> = {
  women: 'women',
  men: 'men',
  creators: 'creators',
  digital: 'creators',
  'new faces': 'new_faces',
};

export function parseOfficeValue(raw: string): OfficeId | null {
  return OFFICE_NAMES[raw.trim().toLowerCase()] ?? null;
}

export function parseDivisionValue(raw: string): Board | null {
  return DIVISION_NAMES[raw.trim().toLowerCase().replace(/\s+/g, ' ')] ?? null;
}

/** Names match case-insensitively with inner spaces collapsed and accents kept. */
export function nameKey(first: string, last: string): string {
  const clean = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();
  return `${clean(first)}\u0000${clean(last)}`;
}
