// The LEI check (ISO 17442 with ISO 7064 MOD 97-10 check digits) and the made-up address format.

/** True for a 20-character LEI whose check digits pass; lower case is accepted. */
export function isValidLei(value: string): boolean {
  const lei = value.toUpperCase();
  if (!/^[A-Z0-9]{18}[0-9]{2}$/.test(lei)) return false;
  let remainder = 0;
  for (const ch of lei) {
    const digits = /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of digits) remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

export const ADDRESS_MESSAGE = "Each address must be lnl1 followed by 30 lower-case letters or digits.";

export function isValidAddress(value: unknown): value is string {
  return typeof value === "string" && /^lnl1[a-z0-9]{30}$/.test(value);
}
