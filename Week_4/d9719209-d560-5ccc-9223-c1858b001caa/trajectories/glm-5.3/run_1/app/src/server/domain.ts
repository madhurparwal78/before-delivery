/* Domain rules that live in exactly one place: hot rank, display format,
   cursors, alt fallback, removed/deleted labels, and time formatting. */

export const HOT_EPOCH = 1704067200; // 2024-01-01T00:00:00Z

export function hotRank(score: number, createdAt: Date): number {
  const sign = score > 0 ? 1 : score < 0 ? -1 : 0;
  return sign * Math.log10(Math.max(Math.abs(score), 1)) + (Math.floor(createdAt.getTime() / 1000) - HOT_EPOCH) / 45000;
}

export function displayScore(score: number): string {
  if (Math.abs(score) < 10000) return String(score);
  const thousands = Math.floor(Math.abs(score) / 1000) / 10;
  const oneDecimal = Math.floor(thousands * 10) / 10;
  const sign = score < 0 ? '-' : '';
  return `${sign}${oneDecimal.toFixed(1)}k`;
}

export function formatUtc(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function plural(n: number, singular: string, pluralWord: string): string {
  return n === 1 ? `${n} ${singular}` : `${n} ${pluralWord}`;
}

/* Cursor: base64url (no padding) of "<sort>|<sortKey>|<id>". */
export function encodeCursor(sort: string, sortKey: string, id: number | string): string {
  const raw = `${sort}|${sortKey}|${id}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { sort: string; sortKey: string; id: string } | null {
  let raw: string;
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const parts = raw.split('|');
  if (parts.length !== 3) return null;
  const [sort, sortKey, id] = parts;
  if (sort === '' || id === '') return null;
  return { sort, sortKey, id };
}

export function altFallback(n: number, m: number, username: string): string {
  return `Image ${n} of ${m} posted by ${username}`;
}

export const REMOVED_COMMENT_LABEL = '[removed by moderators]';
export const DELETED_COMMENT_LABEL = '[deleted]';
export const DELETED_POST_TITLE = '[deleted by author]';
