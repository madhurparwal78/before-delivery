// The agenda calendar file (RFC 5545): CRLF lines folded at 75 octets on character boundaries.

interface CalendarEvent {
  id: string;
  title: string;
  where: string;
  start: Date;
  end: Date;
}

const VENUE_SUFFIX = ', Harbour Quay Hall, Port Ashby';
const MAX_OCTETS = 75;

function escapeText(value: string): string {
  let out = '';
  for (const char of value) {
    if (char === '\\' || char === ';' || char === ',') out += `\\${char}`;
    else if (char === '\n') out += '\\n';
    else if (char !== '\r') out += char;
  }
  return out;
}

function utcStamp(instant: Date): string {
  return instant.toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '') + 'Z';
}

function fold(line: string): string {
  const pieces: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    if (octets + size > MAX_OCTETS) {
      pieces.push(current);
      current = ' ';
      octets = 1;
    }
    current += char;
    octets += size;
  }
  pieces.push(current);
  return pieces.join('\r\n');
}

export function calendarFile(events: CalendarEvent[], generatedAt: Date): string {
  const stamp = utcStamp(generatedAt);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Keel Outpost//Agenda//EN', 'CALSCALE:GREGORIAN'];
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@keel-outpost`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utcStamp(event.start)}`,
      `DTEND:${utcStamp(event.end)}`,
      `SUMMARY:${escapeText(event.title)}`,
      `LOCATION:${escapeText(event.where + VENUE_SUFFIX)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
