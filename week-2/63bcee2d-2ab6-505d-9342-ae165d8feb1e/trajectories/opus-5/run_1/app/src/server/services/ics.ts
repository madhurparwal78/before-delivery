/** The tender close calendar file attached to every tender message. */

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.byteLength <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.byteLength) {
    const width = start === 0 ? 75 : 74;
    let end = Math.min(start + width, bytes.byteLength);
    while (end > start && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return parts.join('\r\n ');
}

function utcStamp(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

export function tenderCloseIcs(options: {
  tenderId: string;
  tenderTitle: string;
  closesAt: Date;
  sequence: number;
}): string {
  const stamp = utcStamp(options.closesAt);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Marrow Hall Interiors//Plumbline//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:tender-${options.tenderId}@plumbline`,
    `SEQUENCE:${options.sequence}`,
    `DTSTAMP:${utcStamp(new Date())}`,
    `DTSTART:${stamp}`,
    `DTEND:${stamp}`,
    `SUMMARY:Tender closes: ${escapeText(options.tenderTitle)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
