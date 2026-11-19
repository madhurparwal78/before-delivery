// Microns, mils, paint bands and money: each decided once, on the server, and formatted the same
// way wherever it is shown.

export type Band = 'Thin' | 'Original' | 'Refinished' | 'Filler' | 'Not gauged' | 'No reading' | 'No baseline';

export const MICRONS_MIN = 1;
export const MICRONS_MAX = 2000;

/** Microns divided by 25.4, rounded half up to one decimal, as a string. */
export function mils(microns: number): string {
  const value = microns / 25.4;
  return (Math.round(value * 10 + 1e-9) / 10).toFixed(1);
}

/** The median of a substrate's owner readings, rounded half up to a whole micron. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  if (sorted.length % 2 === 1) return sorted[Math.floor(middle)];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** The band for a reading against its substrate's median. */
export function bandFor(microns: number, substrateMedian: number | null): Band {
  if (substrateMedian === null) return 'No baseline';
  const delta = microns - substrateMedian;
  if (delta < -30) return 'Thin';
  if (delta <= 40) return 'Original';
  if (delta <= 150) return 'Refinished';
  return 'Filler';
}

/** Whole pounds with a comma every three digits, after a pound sign. */
export function money(pounds: number): string {
  const digits = Math.trunc(Math.abs(pounds)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `£${pounds < 0 ? '-' : ''}${grouped}`;
}

/** `<hours>h <minutes>m <seconds>s left`, with whole hours uncapped. */
export function timeLeft(secondsRemaining: number): string {
  const total = Math.max(0, Math.floor(secondsRemaining));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}h ${minutes}m ${seconds}s left`;
}

export const KM_PER_MILE = 1.609344;
