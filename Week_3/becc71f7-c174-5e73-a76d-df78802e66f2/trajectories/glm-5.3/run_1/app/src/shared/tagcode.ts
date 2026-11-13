// Tag codes (DP-09): HG-<seven digits>-<Luhn check digit over the seven digits>.

/** Luhn check digit over the seven digits. */
function luhnCheckDigit(sevenDigits: string): number {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    let d = Number(sevenDigits[i]);
    if (i % 2 === 0) {
      // positions 1,3,5,7 from the left are doubled
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidTagCode(tag: string): boolean {
  const digits = tag.replace(/[^0-9]/g, '');
  if (!/^\d{7}\d$/.test(digits)) return false;
  const seven = digits.slice(0, 7);
  return Number(digits[7]) === luhnCheckDigit(seven);
}

/** Upper-case dashed form: HG-1000042-0 */
export function formatTagCode(digits: string): string {
  const d = digits.replace(/[^0-9]/g, '');
  return `HG-${d.slice(0, 7)}-${d.slice(7, 8)}`;
}

export function tagCodeFromSequence(n: number): string {
  const seven = String(n).padStart(7, '0');
  return `HG-${seven}-${luhnCheckDigit(seven)}`;
}

/** Digits only (8), used as the storage key. */
export function tagCodeDigits(tag: string): string {
  return tag.replace(/[^0-9]/g, '');
}

export function checkDigitOf(digits8: string): number {
  return Number(digits8[7]);
}
