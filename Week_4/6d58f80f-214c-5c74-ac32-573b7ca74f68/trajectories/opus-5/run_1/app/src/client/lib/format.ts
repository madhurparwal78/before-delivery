const PHOENIX_OFFSET_MS = -7 * 60 * 60 * 1000;

/** Sizes use powers of 1,000 with two decimals; plain bytes below a thousand. */
export const formatSize = (bytes: number): string => {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(2)} ${units[unit] ?? 'TB'}`;
};

const shifted = (instant: string): Date => new Date(Date.parse(instant) + PHOENIX_OFFSET_MS);

/** Company-zone timestamp of an instant, written "YYYY-MM-DD HH:MM". */
export const formatDateTime = (instant: string): string =>
  shifted(instant).toISOString().slice(0, 16).replace('T', ' ');

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
