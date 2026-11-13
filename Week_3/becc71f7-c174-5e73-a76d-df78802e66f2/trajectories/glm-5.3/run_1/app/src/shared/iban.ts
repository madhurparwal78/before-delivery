// IBAN validation: ISO 13616 MOD-97 (DP-30, DP-09). One place.

/** Normalise an IBAN for storage: upper case, no spaces. Null when not a plausible IBAN shape. */
export function normaliseIban(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** MOD-97 check. Input must already be normalised (upper case, no spaces). */
export function ibanPassesMod97(normalised: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(normalised)) return false;
  const rearranged = normalised.slice(4) + normalised.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const v = ch >= '0' && ch <= '9' ? Number(ch) : ch.charCodeAt(0) - 55;
    remainder = (remainder * (v >= 10 ? 100 : 10) + v) % 97;
  }
  return remainder === 1;
}

/** True when the raw input is a valid IBAN (accepts lower case and spaces). */
export function isValidIban(raw: string): boolean {
  return ibanPassesMod97(normaliseIban(raw));
}

/** Display form: groups of four. */
export function ibanGroups(normalised: string): string {
  return normalised.replace(/(.{4})/g, '$1 ').trim();
}
