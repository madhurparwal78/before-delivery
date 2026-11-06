/**
 * Plate normalisation: the only place a plate is validated or rewritten.
 *
 * A plate is normalised by uppercasing and removing spaces and hyphens, then
 * matched to its registration country's format, where L is a letter and N a
 * digit. A match is rewritten in that canonical form.
 */

import { PLATE_FORMATS } from '../../shared/seed.js';
import type { RegCountry } from '../../shared/types.js';

export function plateExample(country: RegCountry): string {
  return PLATE_FORMATS[country].example;
}

export function invalidPlateMessage(country: RegCountry): string {
  return `Enter a plate like ${plateExample(country)}.`;
}

function matchesMask(bare: string, mask: string): boolean {
  if (bare.length !== mask.length) return false;
  for (let i = 0; i < mask.length; i += 1) {
    const slot = mask[i];
    const char = bare[i] as string;
    if (slot === 'L' && !/^[A-Z]$/.test(char)) return false;
    if (slot === 'N' && !/^[0-9]$/.test(char)) return false;
  }
  return true;
}

/**
 * The canonical form of a plate, or null when it does not match the country's
 * published format. A null result must make no registry request.
 */
export function canonicalPlate(input: string, country: RegCountry): string | null {
  const bare = input.toUpperCase().replace(/[\s-]/g, '');
  const pattern = PLATE_FORMATS[country].pattern;
  const mask = pattern.replace(/-/g, '');
  if (!matchesMask(bare, mask)) return null;

  let out = '';
  let cursor = 0;
  for (const slot of pattern) {
    if (slot === '-') {
      out += '-';
    } else {
      out += bare[cursor] as string;
      cursor += 1;
    }
  }
  return out;
}

export function isRegCountry(value: unknown): value is RegCountry {
  return value === 'NL' || value === 'BE' || value === 'DE';
}
