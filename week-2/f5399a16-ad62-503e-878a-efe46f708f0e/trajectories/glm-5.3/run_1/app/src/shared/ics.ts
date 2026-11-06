// RFC 5545 calendar files for calls: CRLF line ends, lines folded at 75
// octets without ever splitting a UTF-8 character, the text escapes, UTC
// times with Z, one stable UID across moves, a SEQUENCE that grows by one on
// each move, and METHOD:REQUEST or METHOD:CANCEL.

import { instantOfWall, instantText, type Instant } from "./tz";
import type { Town } from "./copy";

export type CallForIcs = {
  uid: string;
  sequence: number;
  town: Town;
  date: string; // producer's local wall date, yyyy-mm-dd
  time: string; // producer's local wall time, HH:mm
  minutes: number;
  note: string;
  producerName: string;
  producerEmail: string;
  artistEmail: string;
};

function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\r?\n/g, "\\n");
}

// Folds content lines at 75 octets, never splitting a UTF-8 character: the
// first line holds up to 75 octets, a continuation starts with one space and
// holds up to 74.
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let first = true;
  while (start < bytes.length) {
    let limit = start + (first ? 75 : 74);
    if (limit >= bytes.length) {
      parts.push(bytes.subarray(start).toString("utf8"));
      break;
    }
    while (limit > start && (bytes[limit]! & 0xc0) === 0x80) limit--;
    parts.push(bytes.subarray(start, limit).toString("utf8"));
    start = limit;
    first = false;
  }
  return parts.join("\r\n ");
}

function utcStamp(at: Instant): string {
  const t = instantText(at);
  return `${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}T${t.slice(11, 13)}${t.slice(14, 16)}${t.slice(17, 19)}Z`;
}

// The calendar file of a call, as an attachment of the call's mail.
export function calendarFile(call: CallForIcs, method: "REQUEST" | "CANCEL"): string {
  const start = instantOfWall(call.town, call.date, call.time);
  if (start === null) throw new Error("wall time does not exist");
  const end = start + call.minutes * 60;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Noor Bakker Boards//Clapstick//EN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${call.uid}`,
    `SEQUENCE:${call.sequence}`,
    `DTSTAMP:${utcStamp(start)}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    fold(`SUMMARY:${escapeText(`Call with ${call.producerName}`)}`),
    fold(`DESCRIPTION:${escapeText(call.note)}`),
    `ORGANIZER:mailto:${call.artistEmail}`,
    fold(`ATTENDEE:mailto:${call.producerEmail}`),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export const CALENDAR_FILE_NAME = "call.ics";
export const CALENDAR_MIME = "text/calendar";

