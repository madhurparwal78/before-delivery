// tender-close.ics (brief: Services, Mail): one VEVENT at the close instant, text escaped and lines folded
// by iCalendar rules (RFC 5545).

const stamp = (instant: Date): string => instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escapeText = (text: string): string =>
  text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");

/** Folds a content line at 75 octets with CRLF and a space, never inside a character. */
function fold(line: string): string {
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char) > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
    }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function tenderCloseIcs(tender: { id: string; title: string; closesAt: Date; sequence: number }, attendee: string): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Marrow Hall Interiors//Plumbline//EN", "METHOD:REQUEST", "BEGIN:VEVENT",
    `UID:tender-${tender.id}@plumbline`, `DTSTAMP:${stamp(new Date())}`, `SEQUENCE:${tender.sequence}`,
    `DTSTART:${stamp(tender.closesAt)}`, `DTEND:${stamp(tender.closesAt)}`, `SUMMARY:${escapeText(`Tender closes: ${tender.title}`)}`,
    "ORGANIZER:mailto:plumbline@marrowhall.example", `ATTENDEE:mailto:${attendee}`, "END:VEVENT", "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
