/** Digits to a non-negative integer without parsing a number out of text. */
export function digitsToInteger(digits: string): number {
  let value = 0;
  for (const character of digits) value = value * 10 + (character.charCodeAt(0) - 48);
  return value;
}
