// iCalendar text per RFC 5545: CRLF line endings, escaped text values, lines folded at 75 octets.

import { isoInstant } from "./errors.js";

export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

function fold(line: string): string {
  const out: string[] = [];
  let current = "";
  let limit = 75;
  for (const char of line) {
    if (Buffer.byteLength(current + char) > limit) {
      out.push(current);
      current = "";
      limit = 74;
    }
    current += char;
  }
  out.push(current);
  return out.join("\r\n ");
}

/** `YYYYMMDD` from `YYYY-MM-DD`. */
export function icsDate(iso: string): string {
  return iso.replace(/-/g, "");
}

export function icsStamp(ms: number): string {
  return isoInstant(ms).replace(/[-:]/g, "");
}

export function calendar(lines: string[]): string {
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
