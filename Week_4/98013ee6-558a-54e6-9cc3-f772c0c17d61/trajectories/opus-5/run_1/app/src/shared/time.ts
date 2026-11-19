const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

interface ZonedParts {
  year: number;
  month: number;
  day: number;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const parts = formatter.formatToParts(instant);
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return { year: read('year'), month: read('month'), day: read('day') };
}

/** The one relative-time rule, on the business clock. */
export function relativeTime(instant: Date, now: Date, timeZone: string): string {
  const seconds = Math.floor((now.getTime() - instant.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 28) return `${Math.floor(days / 7)}w`;
  const then = zonedParts(instant, timeZone);
  const today = zonedParts(now, timeZone);
  const label = `${MONTHS[then.month - 1]} ${then.day}`;
  return then.year === today.year ? label : `${label}, ${then.year}`;
}
