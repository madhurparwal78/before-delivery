import { formatIsoDate, parseIsoDate, type CivilDate } from '../../shared/zone.js';

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Folds at 75 octets with CRLF and one leading space, as RFC 5545 requires. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const pieces: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-byte character.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    pieces.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74;
  }
  return pieces.map((piece, index) => (index === 0 ? piece : ` ${piece}`)).join('\r\n');
}

function compactDate(date: CivilDate): string {
  return formatIsoDate(date).replace(/-/g, '');
}

function compactInstant(instantMs: number): string {
  return `${new Date(instantMs).toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

export type FeedEvent = {
  uid: string;
  date: string;
  endDate: string;
  sequence: number;
  status: 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED';
  summary: string;
  description?: string;
};

function eventLines(event: FeedEvent): string[] {
  const start = parseIsoDate(event.date);
  const end = parseIsoDate(event.endDate);
  if (!start || !end) throw new Error('bad event date');
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTART;VALUE=DATE:${compactDate(start)}`,
    `DTEND;VALUE=DATE:${compactDate(end)}`,
    `SEQUENCE:${event.sequence}`,
    `STATUS:${event.status}`,
    `SUMMARY:${escapeText(event.summary)}`,
  ];
  if (event.description !== undefined) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  lines.push('END:VEVENT');
  return lines;
}

function wrap(lines: string[]): string {
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export function buildCalendar(input: {
  calendarName?: string;
  method?: string;
  stampMs: number;
  events: FeedEvent[];
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vesper & Rowe Talent//Rungboard//EN',
    'CALSCALE:GREGORIAN',
  ];
  if (input.method) lines.push(`METHOD:${input.method}`);
  if (input.calendarName) lines.push(`X-WR-CALNAME:${escapeText(input.calendarName)}`);
  for (const event of input.events) {
    lines.push(...eventLines(event).flatMap((line) =>
      line === 'BEGIN:VEVENT' ? [line, `DTSTAMP:${compactInstant(input.stampMs)}`] : [line]));
  }
  lines.push('END:VCALENDAR');
  return wrap(lines);
}
