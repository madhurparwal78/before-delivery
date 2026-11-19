/** Hours show as a whole number or with one decimal: `10`, `6.5`. */
export function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

/** The signed variance, as the grid and the exports show it: `+3`, `-2`, `0`. */
export function signedVariance(variance: number): string {
  return variance > 0 ? `+${variance}` : String(variance);
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export function varianceText(variance: number): string {
  if (variance === 0) return "On baseline";
  return `${plural(Math.abs(variance), "working day", "working days")} ${variance > 0 ? "later" : "earlier"} than baseline`;
}

export const workingDays = (count: number): string => plural(count, "working day", "working days");
