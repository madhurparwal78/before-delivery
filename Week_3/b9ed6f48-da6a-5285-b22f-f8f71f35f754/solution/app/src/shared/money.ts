// Money is an integer number of minor units with a currency code (brief: Business rules › Money).
// Parsing and formatting work on digit strings, never on floating-point amounts.

export const CURRENCIES = ["EUR", "GBP", "USD", "JPY"] as const;
export type Currency = (typeof CURRENCIES)[number];

const SYMBOLS: Record<Currency, string> = { EUR: "€", GBP: "£", USD: "$", JPY: "¥" };

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

function decimals(currency: Currency): number {
  return currency === "JPY" ? 0 : 2;
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** The `<price>` placeholder: `€12.00`, `¥2,000`. */
export function formatPrice(minor: number, currency: Currency): string {
  const sign = minor < 0 ? "-" : "";
  const digits = String(Math.abs(minor));
  if (decimals(currency) === 0) return `${sign}${SYMBOLS[currency]}${group(digits)}`;
  const padded = digits.padStart(3, "0");
  return `${sign}${SYMBOLS[currency]}${group(padded.slice(0, -2))}.${padded.slice(-2)}`;
}

const TWO_DECIMALS = /^(\d{1,9})(?:\.(\d{1,2}))?$/;
const WHOLE = /^(\d{1,9})$/;

/**
 * An amount field in major units (`25`, `25.00`, `12.5`, `2000` for yen) as minor units,
 * or null when the entry does not fit the amount format.
 */
export function parseAmount(text: string, currency: Currency): number | null {
  const entry = text.trim();
  if (decimals(currency) === 0) {
    const m = WHOLE.exec(entry);
    return m ? Number.parseInt(m[1], 10) : null;
  }
  const m = TWO_DECIMALS.exec(entry);
  if (!m) return null;
  return Number.parseInt(m[1], 10) * 100 + Number.parseInt((m[2] ?? "").padEnd(2, "0"), 10);
}

/** Minor units as the major-unit decimal string an amount field or Kill Bill takes. */
export function minorToMajor(minor: number, currency: Currency): string {
  if (decimals(currency) === 0) return String(minor);
  const padded = String(Math.abs(minor)).padStart(3, "0");
  return `${minor < 0 ? "-" : ""}${padded.slice(0, -2)}.${padded.slice(-2)}`;
}

/**
 * A major-unit amount as Kill Bill reports it (a JSON number such as 12.5) in minor units.
 * Works on the number's shortest decimal text, so no binary rounding enters the result.
 */
export function majorToMinor(amount: number | string, currency: Currency): number {
  const text = typeof amount === "number" ? amount.toString() : amount;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new Error(`unexpected amount ${text}`);
  const places = decimals(currency);
  const fraction = (m[3] ?? "").padEnd(places, "0");
  if (fraction.length > places && /[1-9]/.test(fraction.slice(places))) throw new Error(`amount ${text} has sub-minor digits`);
  const minor = Number.parseInt(m[2] + fraction.slice(0, places), 10);
  return m[1] === "-" ? -minor : minor;
}
