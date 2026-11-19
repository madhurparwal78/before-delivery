/** A stamp number is eight digits ending in a Luhn check digit. */
export function isStampNumber(text: string): boolean {
  if (!/^\d{8}$/.test(text)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i += 1) {
    const digit = text.charCodeAt(7 - i) - 48;
    if (i % 2 === 0) {
      sum += digit;
    } else {
      const doubled = digit * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    }
  }
  return sum % 10 === 0;
}
