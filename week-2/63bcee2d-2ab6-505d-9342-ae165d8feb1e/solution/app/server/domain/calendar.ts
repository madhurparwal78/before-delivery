// Calendar arithmetic for the defects period (brief: Certificates and retention). The one place the
// defects end date is decided.

/** A calendar date plus whole months, clamped to the last day of a shorter month. */
function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const index = month - 1 + months;
  const targetYear = year + Math.floor(index / 12);
  const targetMonth = ((index % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clamped = Math.min(date, lastDay);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

/** The defects end date: practical completion plus the defects period, or null before practical completion. */
export function defectsEndOn(practicalCompletionOn: string, defectsPeriodMonths: number): string;
export function defectsEndOn(practicalCompletionOn: string | null, defectsPeriodMonths: number): string | null;
export function defectsEndOn(practicalCompletionOn: string | null, defectsPeriodMonths: number): string | null {
  return practicalCompletionOn === null ? null : addMonths(practicalCompletionOn, defectsPeriodMonths);
}
