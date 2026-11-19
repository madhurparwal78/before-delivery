import { isZone, localToInstant } from "../../shared/time.js";

// File formats the imports read: RFC 4180 CSV and RFC 5545 iCalendar.

/** Parses CSV text into records with the physical line each record starts on (header = line 1). */
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  const source = text.replace(/^﻿/, "");
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  let touchedRecord = false;
  const endRecord = () => {
    cells.push(cell);
    if (touchedRecord || cells.length > 1 || cell !== "") records.push({ line: start, cells });
    cells = [];
    cell = "";
    touchedRecord = false;
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else {
        if (char === "\n") line++;
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
      touchedRecord = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
      touchedRecord = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      endRecord();
      line++;
      start = line;
    } else cell += char;
  }
  if (cell !== "" || cells.length > 0 || touchedRecord) endRecord();
  return records;
}

type CalendarEvent = { uid: string; summary: string; start: number; end: number };

type Property = { name: string; params: Record<string, string>; value: string };

function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length) out[out.length - 1] += raw.slice(1);
    else if (raw.length) out.push(raw);
  }
  return out;
}

function property(line: string): Property | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** A date-time with UTC "Z" or an IANA TZID; null for date-only or floating values. */
function instant(prop: Property): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(prop.value);
  if (!match || prop.params.VALUE === "DATE") return null;
  const [, y, mo, d, h, mi, s, z] = match;
  if (z) return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const zone = prop.params.TZID;
  if (!zone || !isZone(zone)) return null;
  return localToInstant(`${y}-${mo}-${d}`, `${h}:${mi}`, zone) + Number(s) * 1000;
}

function duration(value: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match || value === "P" || value.endsWith("T")) return null;
  const [, sign, w, d, h, m, s] = match;
  const ms = ((Number(w ?? 0) * 7 + Number(d ?? 0)) * 86_400 + Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)) * 1000;
  return sign === "-" ? -ms : ms;
}

/** Returns the importable events and how many VEVENTs were skipped, or null when it is no calendar. */
export function parseCalendar(text: string): { events: CalendarEvent[]; skipped: number } | null {
  const lines = unfold(text);
  if (!lines.some((l) => l.toUpperCase() === "BEGIN:VCALENDAR")) return null;
  const events: CalendarEvent[] = [];
  let skipped = 0;
  let current: Property[] | null = null;
  let depth = 0;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = [];
      depth = 0;
    } else if (current && upper === "END:VEVENT") {
      const get = (name: string) => current?.find((p) => p.name === name);
      const uid = get("UID")?.value.trim();
      const startProp = get("DTSTART");
      const endProp = get("DTEND");
      const durationProp = get("DURATION");
      const start = startProp ? instant(startProp) : null;
      let end: number | null = null;
      if (start !== null && endProp) end = instant(endProp);
      else if (start !== null && durationProp) {
        const length = duration(durationProp.value.trim());
        end = length === null ? null : start + length;
      }
      if (!uid || start === null || end === null || end <= start || get("RRULE")) skipped++;
      else events.push({ uid, summary: unescapeText(get("SUMMARY")?.value ?? "").trim() || "Untitled meeting", start, end });
      current = null;
    } else if (current) {
      if (upper.startsWith("BEGIN:")) depth++;
      else if (upper.startsWith("END:")) depth--;
      else if (depth === 0) {
        const prop = property(line);
        if (prop) current.push(prop);
      }
    }
  }
  return { events, skipped };
}
