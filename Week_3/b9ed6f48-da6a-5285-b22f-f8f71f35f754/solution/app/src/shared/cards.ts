// Card numbers: 16 digits, spaces allowed, Luhn-valid (brief: API › Commerce).

/** The 16 digits of a well-formed card entry, or null. */
export function cardDigits(entry: string): string | null {
  const digits = entry.replace(/ /g, "");
  if (!/^\d{16}$/.test(digits)) return null;
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let d = digits.charCodeAt(15 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0 ? digits : null;
}
