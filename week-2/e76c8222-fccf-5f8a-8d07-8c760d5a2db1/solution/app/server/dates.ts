// Calendar arithmetic on YYYY-MM-DD agency dates.

export function addDays(date: string, days: number): string {
  const [y = 0, m = 1, d = 1] = date.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
