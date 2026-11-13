/**
 * IBANs are checked by ISO 13616 MOD-97. BE68 5390 0754 7034 is valid and
 * BE68 5390 0754 7035 is not. The MOD-97 check lives here alone.
 */

/** Lower case and spaces are accepted on input; IBANs are stored without spaces in upper case. */
export function normaliseIban(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

export function isValidIban(input: string | null): boolean {
  if (input === null) return false;
  const iban = normaliseIban(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const value =
      character >= '0' && character <= '9'
        ? character
        : String(character.charCodeAt(0) - 'A'.charCodeAt(0) + 10);
    for (const digit of value) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}
