/** A calendar file by RFC 5545: CRLF line ends, folded at 75 octets. */
export type CalendarCall = {
  uid: string;
  sequence: number;
  startsAt: Date;
  endsAt: Date;
  producerName: string;
  producerEmail: string;
  organiserEmail: string;
  note: string;
  cancelled: boolean;
};

export function calendarFile(call: CalendarCall): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Noor Bakker Boards//Clapstick//EN',
    `METHOD:${call.cancelled ? 'CANCEL' : 'REQUEST'}`,
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${call.uid}`,
    `SEQUENCE:${call.sequence}`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${utcStamp(call.startsAt)}`,
    `DTEND:${utcStamp(call.endsAt)}`,
    `SUMMARY:${escapeText(`Call with ${call.producerName}`)}`,
    `DESCRIPTION:${escapeText(call.note)}`,
    `ORGANIZER:mailto:${call.organiserEmail}`,
    `ATTENDEE:mailto:${call.producerEmail}`,
    ...(call.cancelled ? ['STATUS:CANCELLED'] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

function utcStamp(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

function escapeText(text: string): string {
  return text
    .split('\\')
    .join('\\\\')
    .split('\n')
    .join('\\n')
    .split(';')
    .join('\\;')
    .split(',')
    .join('\\,');
}

/** Lines are folded at 75 octets without ever splitting a UTF-8 character. */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const pieces: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    while (end > start && end < bytes.length && isContinuationByte(bytes[end] as number)) {
      end -= 1;
    }
    pieces.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74;
  }
  return pieces.join('\r\n ');
}

function isContinuationByte(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}
