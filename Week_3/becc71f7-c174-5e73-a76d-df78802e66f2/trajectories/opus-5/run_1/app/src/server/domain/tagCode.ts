/**
 * A tag code is `HG-`, seven digits, `-` and a Luhn check digit over the seven digits.
 * HG-1000042-0 is valid and HG-1000042-1 is not. The Luhn check lives here alone.
 */

const DIGITS = 7;

function luhnCheckDigit(payload: string): number {
  let sum = 0;
  for (let i = 0; i < payload.length; i += 1) {
    const digit = Number(payload[payload.length - 1 - i]);
    if (i % 2 === 0) {
      const doubled = digit * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    } else {
      sum += digit;
    }
  }
  return (10 - (sum % 10)) % 10;
}

/** The upper-case dashed tag code for a seven-digit serial number. */
export function tagCodeForSerial(serial: number): string {
  const payload = String(serial).padStart(DIGITS, '0');
  return `HG-${payload}-${luhnCheckDigit(payload)}`;
}

export interface ParsedTagCode {
  tagCode: string;
  serial: number;
}

/**
 * Lookup ignores letter case and dashes and always answers with the upper-case
 * dashed form. `null` means the code is not well formed or its check digit fails.
 */
export function parseTagCode(input: string): ParsedTagCode | null {
  const bare = input.replace(/[\s-]/g, '').toUpperCase();
  const match = /^HG(\d{7})(\d)$/.exec(bare);
  if (!match) return null;
  const payload = match[1] as string;
  const check = match[2] as string;
  if (luhnCheckDigit(payload) !== Number(check)) return null;
  return { tagCode: `HG-${payload}-${check}`, serial: Number(payload) };
}

/** The bare form a tag-code search compares against, so `hg10000420` matches. */
export function bareTagCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}
