// Formatting values the API returns. No date counting or money arithmetic happens in the browser.

/** Cents as dollars with two decimals and a comma thousands separator. */
export function dollars(cents: number): string {
  const digits = String(cents).padStart(3, "0");
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+$)/g, ",");
  return `${whole}.${digits.slice(-2)}`;
}

/** An API timestamp (already in the library's offset) as library-local `YYYY-MM-DD HH:MM`. */
export function libraryStamp(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/** Typed dollars (`12`, `12.5`, `12.50`) rewritten as the cents digits the API takes (`1250`), by moving the
 *  decimal point in the text; no arithmetic. Null when the text is not a dollar amount. */
export function centsFromTyped(text: string): number | null {
  const m = /^\s*\$?(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  return Number.parseInt(`${m[1]}${(m[2] ?? "").padEnd(2, "0")}`, 10);
}

export const bytes = (n: number) => `${n.toLocaleString("en-US")} bytes`;

export const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
