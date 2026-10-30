/** `<hours>`: minutes ÷ 60 with two decimals, rounded half-up (brief: Feedback states placeholders). */
export function formatHours(minutes: number): string {
  const hundredths = Math.floor((minutes * 100 * 2 + 60) / 120);
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}

/** `$<amount>`: US dollars with two decimals, from integer cents. */
export function formatMoney(cents: number): string {
  return `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
