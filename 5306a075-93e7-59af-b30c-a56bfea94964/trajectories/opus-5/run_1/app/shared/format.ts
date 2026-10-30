const MONTH_NAMES = [
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
];

const SHORT_MONTH_NAMES = MONTH_NAMES.map((name) => name.slice(0, 3));

/** "2027-03" -> "March 2027" */
export function monthLabel(month: string): string {
  const [year, index] = month.split('-');
  return `${MONTH_NAMES[Number(index) - 1]} ${year}`;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const partCache = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = partCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  partCache.set(timeZone, formatter);
  return formatter;
}

export function zonedParts(instantMs: number, timeZone: string): ZonedParts {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(instantMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
  };
}

/** "Mar 14, 2027, 3:30 AM" in the workspace time zone. */
export function formatZonedDateTime(isoInstant: string, timeZone: string): string {
  const parts = zonedParts(Date.parse(isoInstant), timeZone);
  const period = parts.hour < 12 ? 'AM' : 'PM';
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  const minute = String(parts.minute).padStart(2, '0');
  return `${SHORT_MONTH_NAMES[parts.month - 1]} ${parts.day}, ${parts.year}, ${hour12}:${minute} ${period}`;
}

/** "2027-03-15" -> "Mar 15, 2027" */
export function formatCalendarDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${SHORT_MONTH_NAMES[Number(month) - 1]} ${Number(day)}, ${year}`;
}
