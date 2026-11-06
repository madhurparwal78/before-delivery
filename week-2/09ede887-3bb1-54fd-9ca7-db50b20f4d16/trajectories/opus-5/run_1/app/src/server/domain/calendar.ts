export interface CalendarEvent {
  readonly id: string;
  readonly startInstant: Date;
  readonly endInstant: Date;
  readonly title: string;
  readonly locationName: string;
}

const VENUE_SUFFIX = ', Harbour Quay Hall, Port Ashby';

function instantToIcs(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds a content line at 75 octets without ever splitting a character. */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const pieces: string[] = [];
  let offset = 0;
  let limit = 75;
  while (offset < bytes.length) {
    let take = Math.min(limit, bytes.length - offset);
    // Step back off a continuation byte so a multi-byte character stays whole.
    while (take > 0 && offset + take < bytes.length && ((bytes[offset + take] as number) & 0xc0) === 0x80) {
      take -= 1;
    }
    pieces.push(bytes.subarray(offset, offset + take).toString('utf8'));
    offset += take;
    limit = 74;
  }
  return pieces.join('\r\n ');
}

export function buildCalendar(events: readonly CalendarEvent[], generatedAt: Date): string {
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Keel Outpost//Agenda//EN'];
  const stamp = instantToIcs(generatedAt);
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@keel-outpost`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${instantToIcs(event.startInstant)}`,
      `DTEND:${instantToIcs(event.endInstant)}`,
      `SUMMARY:${escapeText(event.title)}`,
      `LOCATION:${escapeText(event.locationName + VENUE_SUFFIX)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
