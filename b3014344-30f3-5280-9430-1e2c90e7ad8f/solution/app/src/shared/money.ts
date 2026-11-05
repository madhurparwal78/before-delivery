// Money is held as integer minor units (cents, centavos) in BigInt end to end.
// The API carries amounts as strings with exactly two decimals; nothing here touches floating point.

export type Currency = "USD" | "ARS";

export function isCurrency(value: unknown): value is Currency {
  return value === "USD" || value === "ARS";
}

const AMOUNT = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

/** Parses a decimal amount with at most two decimals ("12", "12.3", "-12.34") into minor units. */
export function parseAmount(text: string): bigint | null {
  const match = AMOUNT.exec(text.trim());
  if (!match) return null;
  const [, sign, whole = "0", fraction = ""] = match;
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  return sign === "-" ? -minor : minor;
}

/** The API string form: exactly two decimals, no grouping. */
export function toAmount(minor: bigint): string {
  const sign = minor < 0n ? "-" : "";
  const value = minor < 0n ? -minor : minor;
  return `${sign}${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

function group(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/** The one display format: `USD 1,999.99`, `ARS 2.350.617,28`, `-USD 120.50`. */
export function formatMoney(minor: bigint, currency: Currency): string {
  const sign = minor < 0n ? "-" : "";
  const value = minor < 0n ? -minor : minor;
  const whole = (value / 100n).toString();
  const cents = (value % 100n).toString().padStart(2, "0");
  return currency === "USD"
    ? `${sign}USD ${group(whole, ",")}.${cents}`
    : `${sign}ARS ${group(whole, ".")},${cents}`;
}

/** Formats an API amount string. */
export function money(amount: string, currency: Currency): string {
  const minor = parseAmount(amount);
  if (minor === null) throw new Error(`not an amount: ${amount}`);
  return formatMoney(minor, currency);
}

/** A build's deposit is 40% of the total rounded down to the cent; the launch balance is the rest. */
export function splitBuild(totalMinor: bigint): { dueNow: bigint; dueAtLaunch: bigint } {
  const dueNow = (totalMinor * 40n) / 100n;
  return { dueNow, dueAtLaunch: totalMinor - dueNow };
}

/** part ÷ whole × 100, rounded half-up to one decimal, as a string such as "40.0". */
export function sharePercent(part: bigint, whole: bigint): string {
  if (whole === 0n) return "0.0";
  const tenths = (part * 2000n + whole) / (2n * whole);
  return `${tenths / 10n}.${tenths % 10n}`;
}
