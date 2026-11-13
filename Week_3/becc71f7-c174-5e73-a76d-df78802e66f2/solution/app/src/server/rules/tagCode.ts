// Tag codes: `HG-`, seven digits, `-` and a Luhn check digit over the seven digits.

function luhnDigit(digits: string): number {
  let total = 0;
  [...digits].reverse().forEach((character, index) => {
    const value = Number(character);
    const doubled = value * 2;
    total += index % 2 === 0 ? (doubled > 9 ? doubled - 9 : doubled) : value;
  });
  return (10 - (total % 10)) % 10;
}

export function tagCodeOf(number: number): string {
  const digits = String(number).padStart(7, "0");
  return `HG-${digits}-${luhnDigit(digits)}`;
}

/** The seven-digit number of a code typed in any case, with or without dashes; null when it is not well formed or its check digit fails. */
export function parseTagCode(text: string): number | null {
  const match = /^HG(\d{7})(\d)$/.exec(text.replaceAll("-", "").trim().toUpperCase());
  if (!match) return null;
  const [, digits, check] = match;
  return luhnDigit(digits) === Number(check) ? Number(digits) : null;
}
