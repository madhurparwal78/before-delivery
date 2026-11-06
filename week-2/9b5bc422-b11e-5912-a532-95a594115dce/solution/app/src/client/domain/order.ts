const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

const digit = (key: string, index: number): number => DIGITS.indexOf(key[index] ?? "0");

/** A key sorting strictly between `low` and `high`; `high` empty means no upper bound. */
export function orderBetween(low: string, high: string): string {
  let key = "";
  for (let index = 0; ; index += 1) {
    const a = digit(low, index);
    const b = high && index < high.length ? digit(high, index) : BASE;
    if (b - a > 1) return key + DIGITS[Math.floor((a + b) / 2)];
    key += DIGITS[a];
    if (b - a === 1) high = "";
  }
}

export const orderAt = (index: number): string => `h${String(index).padStart(4, "0")}`;

export const byOrder = (a: { id: string; fields: { order: string } }, b: { id: string; fields: { order: string } }): number =>
  a.fields.order < b.fields.order ? -1 : a.fields.order > b.fields.order ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
