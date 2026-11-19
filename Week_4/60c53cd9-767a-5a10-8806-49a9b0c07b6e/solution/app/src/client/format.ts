/** Display formats: whole dollars and the sales-office time, using the one shared rule. */
import { DEFAULT_OFFICE_ZONE, formatOfficeTime } from "../shared/office-time.js";
import { formatDollars } from "../shared/figures.js";

const officeZone = (): string =>
  document.querySelector<HTMLMetaElement>('meta[name="sales-office-tz"]')?.content || DEFAULT_OFFICE_ZONE;

export const officeTime = (instant: string | number | Date): string => formatOfficeTime(instant, officeZone());

export const dollars = (price: number): string => `$${formatDollars(price)}`;

export const groupedNumber = (value: number): string => formatDollars(value);

/** `hh:mm:ss`, hours at least two digits. */
export const clockText = (totalSeconds: number): string => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
};

/**
 * The photograph at 600, 780 and 960 pixels wide beside the stored original. The panel crops the 3:1 skyline to its own
 * shape, so each size is picked to stay under 2.5x the width the picture is shown at.
 */
export const viewSrcSet = (url: string): string => `${url}?w=600 600w, ${url}?w=780 780w, ${url}?w=960 960w, ${url} 1536w`;

/** The detail panel is 3:2: the width slot to read the srcset against at each layout breakpoint (the skyline is cropped to it). */
export const PANEL_SIZES = "(max-width: 420px) 600px, (max-width: 900px) 780px, 960px";
