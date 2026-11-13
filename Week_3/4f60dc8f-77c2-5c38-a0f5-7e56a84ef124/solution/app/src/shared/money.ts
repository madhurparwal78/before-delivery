// The currency exponent table and the money display format, shared by the server and the browser.

export const CURRENCIES = {
  GBP: { exponent: 2, symbol: "£" },
  EUR: { exponent: 2, symbol: "€" },
  USD: { exponent: 2, symbol: "$" },
  JPY: { exponent: 0, symbol: "¥" },
} as const;

export type Currency = keyof typeof CURRENCIES;

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && Object.hasOwn(CURRENCIES, value);
}

export function exponentOf(currency: Currency): number {
  return CURRENCIES[currency].exponent;
}

function splitMinor(minor: number, currency: Currency): { whole: string; fraction: string } {
  const exponent = exponentOf(currency);
  const digits = String(Math.abs(minor)).padStart(exponent + 1, "0");
  return {
    whole: exponent ? digits.slice(0, -exponent) : digits,
    fraction: exponent ? digits.slice(-exponent) : "",
  };
}

/** `£1,080.00`, `¥110,926`: symbol, comma thousands, as many decimals as the exponent. */
export function formatMoney(minor: number, currency: Currency): string {
  const { whole, fraction } = splitMinor(minor, currency);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${minor < 0 ? "-" : ""}${CURRENCIES[currency].symbol}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** Major units with exactly the exponent's decimals and no grouping: `524.25`, `44370`. */
export function toMajorString(minor: number, currency: Currency): string {
  const { whole, fraction } = splitMinor(minor, currency);
  return `${minor < 0 ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Exact parse of a decimal string in major units into minor units. */
export function majorToMinor(text: string, currency: Currency): number {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) throw new Error(`not a decimal amount: ${text}`);
  const exponent = exponentOf(currency);
  const fraction = (match[3] ?? "").padEnd(exponent, "0");
  if (fraction.length > exponent && /[^0]/.test(fraction.slice(exponent))) throw new Error(`amount ${text} has sub-minor digits`);
  const minor = Number(`${match[2]}${fraction.slice(0, exponent)}`);
  return match[1] === "-" ? -minor : minor;
}
