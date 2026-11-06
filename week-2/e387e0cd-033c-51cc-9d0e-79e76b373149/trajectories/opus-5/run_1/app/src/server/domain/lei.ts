/** ISO 17442 LEI with ISO 7064 MOD 97-10 check digits. */

const SHAPE = /^[A-Z0-9]{20}$/;

export function isValidLei(input: string): boolean {
  const upper = input.toUpperCase();
  if (!SHAPE.test(upper)) return false;
  let remainder = 0;
  for (const character of upper) {
    const value =
      character >= '0' && character <= '9'
        ? character.charCodeAt(0) - 48
        : character.charCodeAt(0) - 55;
    remainder = (remainder * (value >= 10 ? 100 : 10) + value) % 97;
  }
  return remainder === 1;
}

export function canonicalLei(input: string): string {
  return input.toUpperCase();
}
