const AMOUNT = /^\d{1,12}\.\d{2}$/;

export const isAmount = (text: unknown): text is string => typeof text === "string" && AMOUNT.test(text);

/** `1000.00` to integer cents. */
export function toCents(amount: string): number {
  return Number(amount.replace(".", ""));
}

export function fromCents(cents: number | null): string | null {
  if (cents === null) return null;
  const digits = String(cents).padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
