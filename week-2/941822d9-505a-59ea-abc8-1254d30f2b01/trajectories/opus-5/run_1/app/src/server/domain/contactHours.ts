/** Contact hours are held as hundredths of an hour and always land on a quarter hour. */

const MINUTES_PER_QUARTER_HOUR = 15;
const HUNDREDTHS_PER_QUARTER_HOUR = 25;

/** Learning minutes divided by 60, rounded down to the nearest quarter hour. */
export function contactHoursHundredths(minutes: number): number {
  const quarters = (minutes - (minutes % MINUTES_PER_QUARTER_HOUR)) / MINUTES_PER_QUARTER_HOUR;
  return quarters * HUNDREDTHS_PER_QUARTER_HOUR;
}

export function formatHours(hundredths: number): string {
  return `${Math.trunc(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
}

/** verified minutes × 100 / total minutes, rounded down to a whole number. */
export function progressPercent(verifiedMinutes: number, totalMinutes: number): number {
  if (totalMinutes === 0) return 0;
  const product = verifiedMinutes * 100;
  return (product - (product % totalMinutes)) / totalMinutes;
}
