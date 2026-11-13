/** Limits of every text the server accepts, in Unicode code points, inclusive. */
export const LIMITS = {
  name: 40,
  answer: 120,
  query: 80,
  reason: 280,
} as const;

/** Every text is normalised to NFC and trimmed before it is counted, stored or compared. */
export function normalizeText(value: string): string {
  return value.normalize("NFC").trim();
}

/** The counting rule shared by the server checks and the live counters. */
export function countCodePoints(value: string): number {
  return Array.from(normalizeText(value)).length;
}

export function caseFold(value: string): string {
  return value.toUpperCase().toLowerCase();
}

/** Case- and accent-insensitive form used to match archive searches. */
export function searchForm(value: string): string {
  return caseFold(normalizeText(value).normalize("NFD").replace(/\p{M}/gu, ""));
}

/** Time sent as HH:MM:SS of an ISO timestamp in UTC, truncated, never rounded. */
export function timeSent(iso: string): string {
  return iso.slice(11, 19);
}
