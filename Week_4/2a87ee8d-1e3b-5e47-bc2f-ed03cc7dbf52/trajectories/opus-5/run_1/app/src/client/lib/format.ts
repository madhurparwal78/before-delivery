const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function partsIn(instantMs: number, timeZone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') parts[part.type] = Number.parseInt(part.value, 10);
  }
  if (parts.hour === 24) parts.hour = 0;
  return parts;
}

/** "4 Mar 2027" in the facilitator's time zone. */
export function displayDate(instantMs: number, timeZone: string): string {
  const parts = partsIn(instantMs, timeZone);
  return `${parts.day} ${MONTHS[(parts.month ?? 1) - 1]} ${parts.year}`;
}

/** "4 Mar 2027" from a `YYYY-MM-DD` date, with no zone conversion. */
export function displayDateOnly(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  return `${Number.parseInt(match[3] as string, 10)} ${MONTHS[Number.parseInt(match[2] as string, 10) - 1]} ${match[1]}`;
}

/** "HH:mm" in the given zone. */
export function displayTime(instantMs: number, timeZone: string): string {
  const parts = partsIn(instantMs, timeZone);
  return `${String(parts.hour ?? 0).padStart(2, '0')}:${String(parts.minute ?? 0).padStart(2, '0')}`;
}

/** A stored `YYYY-MM-DDTHH:MM` wall clock shown as "4 Mar 2027, 14:00". */
export function displayWallClock(wallClock: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wallClock);
  if (!match) return wallClock;
  const day = Number.parseInt(match[3] as string, 10);
  const month = MONTHS[Number.parseInt(match[2] as string, 10) - 1];
  return `${day} ${month} ${match[1]}, ${match[4]}:${match[5]}`;
}

/** A euro amount formatted for the United Kingdom, for example 1,250.10. */
export function displayAmount(amount: string): string {
  const negative = amount.startsWith('-');
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole = '0', fraction = '0'] = unsigned.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

/** "mm:ss", counting whole seconds, never below zero. */
export function countdown(remainingMs: number): string {
  const total = Math.max(0, Math.round(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function noteCountLabel(count: number): string {
  return count === 1 ? '1 note' : `${count} notes`;
}

export function hiddenCountLabel(count: number): string {
  return `${count} hidden`;
}
