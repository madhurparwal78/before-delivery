import { addDays, todayIn } from "../../shared/time.js";
import { newToken, planner } from "../auth.js";
import { sql } from "../db.js";
import { json, notFoundText, route, type Context } from "../http.js";
import { expandRoutines, routinesOf } from "../routines.js";

const FEED_PAST_DAYS = 7;
const FEED_FUTURE_DAYS = 28;
/** The iCalendar object version every RFC 5545 file declares. */
const ICALENDAR_VERSION = "2.0";

function feedUrl(ctx: Context, token: string): string {
  return `${ctx.origin}/feed/${token}.ics`;
}

route("GET", "/api/feed", async (ctx) => {
  const { member } = await planner(ctx);
  const [row] = await sql<{ feed_token: string }[]>`SELECT feed_token FROM members WHERE id = ${member.id}`;
  return json(200, { url: feedUrl(ctx, row.feed_token) });
});

route("POST", "/api/feed/rotate", async (ctx) => {
  const { member } = await planner(ctx);
  const [row] = await sql<{ feed_token: string }[]>`
    UPDATE members SET feed_token = ${newToken()} WHERE id = ${member.id} RETURNING feed_token`;
  return json(200, { url: feedUrl(ctx, row.feed_token) });
});

const stamp = (instant: number) => new Date(instant).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line at 75 octets (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = Buffer.from(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (Buffer.byteLength(current + char) > limit) {
      parts.push(current);
      current = "";
    }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function vevent(uid: string, summary: string, start: number, end: number, now: number): string[] {
  return ["BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${escapeText(summary)}`, "END:VEVENT"];
}

route("GET", "/feed/{file*}", async (ctx) => {
  const match = /^([A-Za-z0-9_-]{32,})\.ics$/.exec(ctx.params.file);
  const [member] = match
    ? await sql<{ id: string; time_zone: string }[]>`
        SELECT id, time_zone FROM members WHERE feed_token = ${match[1]} AND removed_at IS NULL AND role <> 'operator'`
    : [];
  if (!member) return notFoundText();
  const now = Date.now();
  const today = todayIn(member.time_zone, now);
  const [sessions, routines] = await Promise.all([
    sql<{ id: string; title: string; starts_at: Date; ends_at: Date }[]>`
      SELECT s.id, t.title, s.starts_at, s.ends_at FROM sessions s JOIN tasks t ON t.id = s.task_id
      WHERE s.member_id = ${member.id} ORDER BY s.starts_at`,
    routinesOf(sql, member.id),
  ]);
  const occurrences = expandRoutines(routines, addDays(today, -FEED_PAST_DAYS), addDays(today, FEED_FUTURE_DAYS), member.time_zone);
  const lines = [
    "BEGIN:VCALENDAR",
    `VERSION:${ICALENDAR_VERSION}`,
    "PRODID:-//Tidemark Daybook//Feed//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Tidemark Daybook",
    ...sessions.flatMap((s) => vevent(`session-${s.id}@tidemark`, s.title, s.starts_at.getTime(), s.ends_at.getTime(), now)),
    ...occurrences.flatMap((o) => vevent(`routine-${o.routineId}-${o.date.replace(/-/g, "")}@tidemark`, o.name, o.start, o.end, now)),
    "END:VCALENDAR",
  ];
  return {
    status: 200,
    body: `${lines.map(fold).join("\r\n")}\r\n`,
    contentType: "text/calendar; charset=utf-8",
    headers: { "Cache-Control": "no-store" },
  };
});
