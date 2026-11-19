const STAMP_FORM = /^\d{8}$/;

/** Eight digits, the last a Luhn check digit. */
export function isStampNumber(stamp: string): boolean {
  if (!STAMP_FORM.test(stamp)) return false;
  let total = 0;
  [...stamp].reverse().forEach((digit, position) => {
    const value = Number(digit);
    const doubled = position % 2 === 1 ? value * 2 : value;
    total += doubled > 9 ? doubled - 9 : doubled;
  });
  return total % 10 === 0;
}
