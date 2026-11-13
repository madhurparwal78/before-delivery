export { formatDollars } from "../../shared/money";

/** `YYYY-MM-DD` from an agency ISO timestamp (the offset in the string is the agency's, never the browser's). */
export const dateOf = (iso: string): string => iso.slice(0, 10);

/** `HH:MM` from an agency ISO timestamp. */
export const timeOf = (iso: string): string => iso.slice(11, 16);

export const dateTimeOf = (iso: string): string => `${dateOf(iso)} ${timeOf(iso)}`;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** `<weekday short name> <date> <time>` for the late-window cutoff, read from the date text itself. */
export function cutoffLabel(iso: string): string {
  const [year = 0, month = 1, day = 1] = dateOf(iso).split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
  return `${weekday} ${dateOf(iso)} ${timeOf(iso)}`;
}

/** Elapsed minutes between two agency timestamps; the offsets in the strings make this exact across clock changes. */
export const minutesBetween = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / 60_000);

export const withCommas = (count: number): string => count.toLocaleString("en-US");

/** Digits typed into a whole-number field become the number; anything else is sent as typed so the server names the field. */
export const wholeNumberOrText = (text: string): number | string => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : text);
