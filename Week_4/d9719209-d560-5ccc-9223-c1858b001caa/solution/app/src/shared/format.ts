const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Scores below 10,000 in magnitude print as integers; larger ones as thousands with one decimal, truncated. */
export function displayScore(score: number): string {
  if (Math.abs(score) < 10_000) return String(score);
  const tenths = Math.trunc(Math.abs(score) / 100);
  return `${score < 0 ? '-' : ''}${Math.trunc(tenths / 10)}.${tenths % 10}k`;
}

export function countLabel(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

/** "3 Nov 2026, 14:05 UTC" */
export function utcLabel(iso: string): string {
  const t = new Date(iso);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export function utcDateLabel(iso: string): string {
  const t = new Date(iso);
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

/** The deadline cell: whole minutes remaining rounded up, shown as hours and minutes. */
export function deadlineLabel(secondsRemaining: number, overdue: boolean): string {
  if (overdue) return 'Overdue';
  const minutes = Math.ceil(secondsRemaining / 60);
  return `Due in ${Math.trunc(minutes / 60)} h ${minutes % 60} min`;
}
