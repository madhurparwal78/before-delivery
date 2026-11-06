import { formatDay, formatMoney } from "../../shared/format.js";

/** ICS writing: escaping, folding, CRLF line endings (RFC 5545). */

const CRLF = "\r\n";

export function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

export function foldLine(line: string): string[] {
  if (line.length <= 75) return [line];
  const out: string[] = [];
  let current = line;
  out.push(current.slice(0, 75));
  current = current.slice(75);
  while (current.length > 0) {
    const chunk = current.slice(0, 74);
    out.push(` ${chunk}`);
    current = current.slice(74);
  }
  return out;
}

export function icsLines(lines: string[]): string {
  const folded = lines.flatMap(foldLine);
  return folded.join(CRLF);
}

export function nextDay(dateOnly: string): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** The booking confirmation attachment. */
export function icsForBooking(reference: string, date: string, jobTitle: string, talentNames: string, totalCents: number): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Vesper & Rowe Talent//Rungboard//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:booking-${reference}@rungboard.vesperrowe.example`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART;VALUE=DATE:${date.replace(/-/g, "")}`,
    `DTEND;VALUE=DATE:${nextDay(date).replace(/-/g, "")}`,
    `SUMMARY:${icsEscape(`${jobTitle}: ${talentNames}`)}`,
    `DESCRIPTION:${icsEscape(`Total: ${formatMoney(totalCents)}`)}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return icsLines(lines);
}

function icsStamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
}

export interface FeedEvent {
  optionId: string;
  date: string;
  status: "TENTATIVE" | "CONFIRMED" | "CANCELLED";
  summary: string;
  sequence: number;
}

/** The talent calendar feed. */
export function renderFeed(displayName: string, events: FeedEvent[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Vesper & Rowe Talent//Rungboard//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(`${displayName} — Rungboard`)}`,
  ];
  for (const event of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:option-${event.optionId}@rungboard.vesperrowe.example`);
    lines.push(`DTSTAMP:${icsStamp(new Date())}`);
    lines.push(`DTSTART;VALUE=DATE:${event.date.replace(/-/g, "")}`);
    lines.push(`DTEND;VALUE=DATE:${nextDay(event.date).replace(/-/g, "")}`);
    lines.push(`SUMMARY:${icsEscape(event.summary)}`);
    lines.push(`STATUS:${event.status}`);
    lines.push(`SEQUENCE:${event.sequence}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return icsLines(lines);
}

export function tentativeSummary(ordinalText: string, jobTitle: string, company: string, releaseTime: string): string {
  return `${ordinalText} option: ${jobTitle} for ${company}, releases ${releaseTime}`;
}

export function bookedSummary(jobTitle: string, company: string): string {
  return `Booked: ${jobTitle} for ${company}`;
}

export { formatDay };
