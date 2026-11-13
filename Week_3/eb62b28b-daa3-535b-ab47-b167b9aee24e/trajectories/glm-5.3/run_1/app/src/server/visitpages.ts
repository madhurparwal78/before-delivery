import type { Database } from "./db.js";
import { newId } from "./crypto.js";
import { instantZ, localDateIn, nextLocalMidnight, zoneFor } from "../shared/time.js";
import type { TimeZoneKey } from "../shared/enums.js";
import { ApiError } from "./errors.js";
import { copy } from "../shared/copy.js";
import { queueMail } from "./mailer.js";
import { SLOT_TIMES } from "../shared/slots.js";
import { DateTime } from "luxon";

export type VisitPageRow = {
  token: string;
  draw_id: string;
  state: string;
  ends_at: Date;
  sent_at: Date;
};

export type DrawRow = {
  id: string;
  member_id: string;
  phlebotomist_id: string;
  state: string;
  starts_at: Date;
  local_date: string;
  local_time: string;
  time_zone: string;
  collected_at: Date | null;
  kit_codes: string[];
};

/**
 * The visit page end instant: the next member-local midnight after the draw day,
 * or DRAW_PAGE_SECONDS after it was sent when that is sooner.
 * This is the one place the end instant is decided.
 */
export function visitPageEndsAt(
  localDate: string,
  timeZone: TimeZoneKey,
  sentAt: Date,
  drawPageSeconds: number | null
): Date {
  const endOfDay = nextLocalMidnight(DateTime.fromISO(`${localDate}T00:00:00`, { zone: zoneFor(timeZone) }).toJSDate(), zoneFor(timeZone));
  if (drawPageSeconds !== null) {
    const capped = new Date(sentAt.getTime() + drawPageSeconds * 1000);
    return capped < endOfDay ? capped : endOfDay;
  }
  return endOfDay;
}

/** End any live visit page for a draw (the unique live index enforces one at a time). */
export async function endVisitPages(db: Database, drawId: string): Promise<void> {
  await db.exec(
    `UPDATE visit_pages SET state = 'ended' WHERE draw_id = $1 AND state = 'live'`,
    [drawId]
  );
}

/** Create a new visit page, ending the old one, and mail the phlebotomist. */
export async function issueVisitPage(
  db: Database,
  draw: DrawRow,
  phlebotomistEmail: string,
  memberFirstName: string,
  memberLastInitial: string,
  publicUrl: string,
  drawPageSeconds: number | null
): Promise<{ token: string; endsAt: Date }> {
  await endVisitPages(db, draw.id);
  const token = newId("visit").replace(/_/g, "") + newId("v").replace(/_/g, "");
  const sentAt = new Date();
  const endsAt = visitPageEndsAt(draw.local_date, draw.time_zone as TimeZoneKey, sentAt, drawPageSeconds);
  await db.exec(
    `INSERT INTO visit_pages (token, draw_id, state, ends_at, sent_at) VALUES ($1, $2, 'live', $3, $4)`,
    [token, draw.id, endsAt, sentAt]
  );
  const drawTime = `${draw.local_date}, ${draw.local_time} ${cityForZone(draw.time_zone)}`;
  const body = [
    `Hello,`,
    ``,
    `A fasting blood draw is booked for ${memberFirstName} ${memberLastInitial}.`,
    `Draw time: ${drawTime}.`,
    ``,
    `Open the private visit page on the day:`,
    `${publicUrl}/visit/${token}`,
    ``,
    `This address ends at the end of the draw day. Please keep it to yourself.`,
  ].join("\n");
  await queueMail(db, {
    to: phlebotomistEmail,
    subject: `Visit page for ${draw.local_date}`,
    body,
  });
  return { token, endsAt };
}

function cityForZone(timeZone: string): string {
  const map: Record<string, string> = {
    newYork: "New York",
    chicago: "Chicago",
    denver: "Denver",
    phoenix: "Phoenix",
    losAngeles: "Los Angeles",
  };
  return map[timeZone] ?? timeZone;
}

export type LiveVisitPage = {
  token: string;
  ends_at: Date;
  state: string;
};

export async function liveVisitPage(db: Database, drawId: string): Promise<LiveVisitPage | null> {
  const row = await db.one<LiveVisitPage>(
    `SELECT token, ends_at, state FROM visit_pages WHERE draw_id = $1 ORDER BY sent_at DESC LIMIT 1`,
    [drawId]
  );
  if (!row) return null;
  return row;
}

/** A request at or after the end instant finds the page ended. */
export async function refreshVisitPageStates(db: Database): Promise<void> {
  await db.exec(
    `UPDATE visit_pages SET state = 'ended' WHERE state = 'live' AND ends_at <= now()`
  );
}

export async function requireLiveVisitPage(
  db: Database,
  token: string
): Promise<{ page: VisitPageRow; draw: DrawRow }> {
  const page = await db.one<VisitPageRow>(
    `SELECT token, draw_id, state, ends_at, sent_at FROM visit_pages WHERE token = $1`,
    [token]
  );
  if (!page) {
    throw new ApiError(404, "not_found", copy("not_found"));
  }
  const ended = page.state === "ended" || page.ends_at.getTime() <= Date.now();
  if (ended) {
    throw new ApiError(410, "visit_page_ended", copy("visit_page_ended"));
  }
  const draw = await db.one<DrawRow & { member_id: string }>(
    `SELECT id, member_id, phlebotomist_id, state, starts_at, local_date, local_time, time_zone, collected_at, kit_codes
     FROM draws WHERE id = $1`,
    [page.draw_id]
  );
  if (!draw) {
    throw new ApiError(404, "not_found", copy("not_found"));
  }
  return { page, draw };
}

/** The next free slot after a taken one on the member's local slot grid. */
export function nextFreeSlotAfter(
  phlebotomistId: string,
  takenInstant: Date,
  busyInstants: Set<string>,
  timeZone: TimeZoneKey
): { date: string; time: string; instant: Date } | null {
  let cursor = DateTime.fromJSDate(takenInstant, { zone: zoneFor(timeZone) }).plus({ minutes: 20 });
  for (let i = 0; i < 500; i++) {
    const localDate = cursor.toFormat("yyyy-MM-dd");
    const weekday = cursor.weekday;
    const time = cursor.toFormat("HH:mm");
    if (weekday >= 1 && weekday <= 6 && SLOT_TIMES.includes(time)) {
      const instant = cursor.toJSDate();
      const key = `${phlebotomistId}|${instant.toISOString()}`;
      if (!busyInstants.has(key)) {
        return { date: localDate, time, instant };
      }
    }
    cursor = cursor.plus({ minutes: 20 });
    if (cursor.hour < 6) {
      cursor = cursor.set({ hour: 6, minute: 0, second: 0, millisecond: 0 });
    }
    while (cursor.hour > 9 || (cursor.hour === 9 && cursor.minute > 40)) {
      cursor = cursor.plus({ days: 1 }).set({ hour: 6, minute: 0, second: 0, millisecond: 0 });
    }
    if (cursor.weekday === 7) {
      cursor = cursor.plus({ days: 1 }).set({ hour: 6, minute: 0, second: 0, millisecond: 0 });
    }
  }
  return null;
}

export function visitMemberName(name: string): { first: string; lastInitial: string } {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  return { first, lastInitial: last.length > 0 ? `${last[0]}.` : "" };
}

export function isDrawDayNow(draw: DrawRow): boolean {
  const today = localDateIn(new Date(), zoneFor(draw.time_zone as TimeZoneKey));
  return today === draw.local_date;
}

export function instantZOf(date: Date): string {
  return instantZ(date);
}
