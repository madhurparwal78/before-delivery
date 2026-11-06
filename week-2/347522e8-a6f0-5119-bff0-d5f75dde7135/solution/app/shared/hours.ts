// Display values: hours are minutes ÷ 60 rounded half up to two decimals; money is integer cents.

export function formatHours(minutes: number): string {
  const hundredths = Math.floor((Math.abs(minutes) * 100 + 30) / 60);
  return `${minutes < 0 ? "−" : ""}${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}

export function formatCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
