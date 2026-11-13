const pad = (value: number): string => String(value).padStart(2, "0");

/** `MM:SS`, or `H:MM:SS` from one hour. */
export function formatClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `November 3, 2026` from `2026-11-03`. */
export function longDate(date: string): string {
  const [year = "", month = "1", day = "1"] = date.split("-");
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`;
}

/** `November 2026` from `2026-11`. */
export function monthTitle(month: string): string {
  const [year = "", number = "1"] = month.split("-");
  return `${MONTHS[Number(number) - 1]} ${year}`;
}

export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

export const stitchesLabel = (count: number): string => (count === 1 ? "1 stitch" : `${count} stitches`);
