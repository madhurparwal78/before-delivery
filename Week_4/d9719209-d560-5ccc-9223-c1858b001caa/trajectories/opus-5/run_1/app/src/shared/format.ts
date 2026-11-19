const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Scores below 10,000 in magnitude read as plain integers, larger ones in thousands with one decimal. */
export function scoreDisplay(score: number): string {
  const magnitude = Math.abs(score);
  if (magnitude < 10000) return String(score);
  const tenths = Math.floor(magnitude / 100);
  const whole = Math.floor(tenths / 10);
  const decimal = tenths % 10;
  return `${score < 0 ? '-' : ''}${whole}.${decimal}k`;
}

/** "3 Nov 2026, 14:05 UTC" */
export function utcTimestamp(iso: string): string {
  const date = new Date(iso);
  const day = date.getUTCDate();
  const month = MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}:${minutes} UTC`;
}

export function countLabel(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

/** Admin queue deadline cell: minutes are rounded up before being split into hours and minutes. */
export function deadlineCell(secondsRemaining: number, overdue: boolean): string {
  if (overdue) return 'Overdue';
  const minutes = Math.ceil(secondsRemaining / 60);
  const hours = Math.floor(minutes / 60);
  return `Due in ${hours} h ${minutes % 60} min`;
}
