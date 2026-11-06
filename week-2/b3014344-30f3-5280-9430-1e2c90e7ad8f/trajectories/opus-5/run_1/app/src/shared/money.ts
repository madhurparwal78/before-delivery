export type Currency = "USD" | "ARS";

export function isCurrency(value: unknown): value is Currency {
  return value === "USD" || value === "ARS";
}

/** An exact amount held as integer minor units (cents or centavos). */
export interface Money {
  readonly currency: Currency;
  readonly minor: bigint;
}

export function money(currency: Currency, minor: bigint): Money {
  return { currency, minor };
}

const AMOUNT_PATTERN = /^-?\d{1,15}(\.\d{1,2})?$/;

/** Reads an API amount string such as "2350617.28" into minor units. */
export function parseAmount(currency: Currency, text: string): Money | null {
  if (!AMOUNT_PATTERN.test(text)) return null;
  const negative = text.startsWith("-");
  const digits = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = digits.split(".");
  const minor = BigInt(whole ?? "0") * 100n + BigInt(fraction.padEnd(2, "0"));
  return { currency, minor: negative ? -minor : minor };
}

/** Reads an amount that a service returned as a JSON number. */
export function fromServiceNumber(currency: Currency, value: number): Money {
  return { currency, minor: BigInt(Math.round(value * 100)) };
}

export function toAmountString(amount: Money): string {
  const negative = amount.minor < 0n;
  const abs = negative ? -amount.minor : amount.minor;
  const whole = abs / 100n;
  const cents = abs % 100n;
  return `${negative ? "-" : ""}${whole.toString()}.${cents.toString().padStart(2, "0")}`;
}

interface CurrencyFormat {
  readonly group: string;
  readonly decimal: string;
}

const FORMATS: Record<Currency, CurrencyFormat> = {
  USD: { group: ",", decimal: "." },
  ARS: { group: ".", decimal: "," },
};

/** The one published money format: `USD 1,999.99`, `ARS 2.350.617,28`, `-USD 120.50`. */
export function formatMoney(amount: Money): string {
  const format = FORMATS[amount.currency];
  const negative = amount.minor < 0n;
  const abs = negative ? -amount.minor : amount.minor;
  const whole = (abs / 100n).toString();
  const cents = (abs % 100n).toString().padStart(2, "0");
  let grouped = "";
  for (let index = 0; index < whole.length; index += 1) {
    if (index > 0 && (whole.length - index) % 3 === 0) grouped += format.group;
    grouped += whole[index];
  }
  return `${negative ? "-" : ""}${amount.currency} ${grouped}${format.decimal}${cents}`;
}

export function absMoney(amount: Money): Money {
  return { currency: amount.currency, minor: amount.minor < 0n ? -amount.minor : amount.minor };
}

/** A share of a total as a percentage with one decimal, rounded half-up. */
export function sharePercent(part: bigint, total: bigint): string {
  if (total === 0n) return "0.0";
  const scaled = (part * 1000n + total / 2n) / total;
  const whole = scaled / 10n;
  const tenths = scaled % 10n;
  return `${whole.toString()}.${tenths.toString()}`;
}

/** The published build split: the deposit is 40% of the total rounded down to the cent. */
export function depositMinor(totalMinor: bigint): bigint {
  return (totalMinor * 40n) / 100n;
}
