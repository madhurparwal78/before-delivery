/** On-screen vocabulary shared by the server's emails and the browser's screens. */

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** "Thursday 12 November 2026" from a `YYYY-MM-DD` studio-local date. */
export function formatStudioDate(date: string): string {
  const [y, m, d] = date.split('-').map((piece) => Number.parseInt(piece, 10));
  const probe = new Date(Date.UTC(y as number, (m as number) - 1, d as number));
  const weekday = WEEKDAY_NAMES[probe.getUTCDay()] as string;
  const month = MONTH_NAMES[(m as number) - 1] as string;
  return `${weekday} ${d} ${month} ${y}`;
}

export const PIECE_STATUS_LABELS = {
  logged: 'Logged',
  waiting_bisque: 'Waiting for bisque',
  bisqued: 'Bisqued',
  waiting_glaze: 'Waiting for glaze',
  glazed: 'Glazed',
  ready_for_pickup: 'Ready for pickup',
  collected: 'Collected',
  uncollected: 'Uncollected',
} as const;

export const LOAD_STATUS_LABELS = {
  planning: 'Planning',
  loaded: 'Loaded',
  firing: 'Firing',
  cooling: 'Cooling',
  unloaded: 'Unloaded',
  cancelled: 'Cancelled',
} as const;

export const OUTCOME_LABELS = {
  intact: 'Intact',
  cracked: 'Cracked',
  damaged: 'Damaged',
} as const;

export type PieceStatus = keyof typeof PIECE_STATUS_LABELS;
export type LoadStatus = keyof typeof LOAD_STATUS_LABELS;
export type Outcome = keyof typeof OUTCOME_LABELS;
