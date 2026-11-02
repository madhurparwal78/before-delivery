import { type ProvinceCode, findProvince } from '../../shared/catalogue.js';

/**
 * Normalises a Canadian postal code to `A1A 1A1` and checks its first letter
 * against the destination province. Input may be lowercase and may omit the space.
 */
export function normalisePostalCode(
  input: string,
  province: ProvinceCode,
): { ok: true; value: string } | { ok: false } {
  const compact = input.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)) return { ok: false };
  const letters = findProvince(province)?.postalLetters ?? [];
  if (!letters.includes(compact[0]!)) return { ok: false };
  return { ok: true, value: `${compact.slice(0, 3)} ${compact.slice(3)}` };
}
