// Formatting: money, dates, tags. No lateness or money calculation happens here.

export function money(cents: number): string {
  const dollars = Math.floor(Math.abs(cents) / 100);
  const rem = Math.abs(cents) % 100;
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${dollars.toLocaleString('en-US')}.${String(rem).padStart(2, '0')}`;
}

/** ISO timestamp to library-local YYYY-MM-DD HH:MM, as the server sent it. */
export function dateTime(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m === null ? iso : `${m[1]} ${m[2]}`;
}

export function dateOnly(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m === null ? iso : m[1]!;
}

/** The overdue line, built only from the server's figures. */
export function overdueLine(days: number, cents: number): string {
  const dayWord = days === 1 ? '1 open day late' : `${days} open days late`;
  return `Overdue — ${dayWord}, ${money(cents)} so far`;
}

export function dueLine(dueDate: string, dueBy: string | null): string {
  return `Due ${dueDate} by ${dueBy ?? ''}`;
}

/** Item status words. */
export function itemStatusWord(status: string): string {
  switch (status) {
    case 'on-wall':
      return 'on the wall';
    case 'pending-photo':
      return 'pending photo';
    default:
      return status;
  }
}

/** Loan status words. */
export function loanStatusWord(status: string): string {
  switch (status) {
    case 'returned-partial':
      return 'incomplete';
    default:
      return status;
  }
}

/** Fee status words. */
export function feeStatusWord(status: string): string {
  return status;
}

/** Hold status words. */
export function holdStatusWord(status: string): string {
  return status;
}

/** The state word for a part outline, from the part state and its tool's status. */
export function outlineStateWord(part: { state: string }, item: ItemLike): string {
  if (part.state === 'missing') return 'missing';
  if (part.state === 'out') return item.status === 'pending-photo' ? 'pending photo' : 'out';
  if (item.status === 'reserved') return 'reserved';
  if (item.status === 'held') return 'held';
  return 'on the wall';
}

export interface ItemLike {
  status: string;
}

export function partLabel(part: { name: string }): string {
  return part.name;
}
