import { randomUUID } from "node:crypto";
import { addSeconds, now } from "../clock.js";
import { config } from "../config.js";
import { one, pool, rows, tx } from "../db.js";
import { ApiError, FIELD, invalid, type FieldErrors } from "../errors.js";
import { logEvents } from "../events.js";
import type { Viewer } from "../http.js";
import { addLocalDays, localIso, localParts, localToInstant, type LocalDateTime } from "./businessTime.js";
import type { MemberChannel } from "./channels.js";
import { isUuid } from "./ids.js";
import { schedules } from "./roles.js";
import { createdEvents, storeMessageRecords, TEXT_LIMIT } from "./send.js";

type State = "scheduled" | "firing" | "sent" | "cancelled";
type Repeat = "none" | "weekly";

type ScheduledRow = {
  id: string;
  workspace_id: string;
  channel_id: string;
  author_id: string;
  text: string;
  repeat: Repeat;
  local_date: string;
  local_time: string;
  time_zone: string;
  state: State;
  next_fire_at: Date | null;
  fired_count: number;
  last_message_id: string | null;
};

type ScheduledJson = Omit<ScheduledRow, "workspace_id" | "author_id" | "next_fire_at"> & {
  next_fire_at: string | null;
  next_fire_local: string | null;
  upcoming_local: string[];
};

const SELECT = `
SELECT s.id, s.workspace_id, s.channel_id, s.author_id, s.text, s.repeat, s.local_date::text AS local_date, s.local_time,
       s.time_zone, s.state, s.next_fire_at,
       (SELECT count(*)::int FROM scheduled_fires f WHERE f.scheduled_id = s.id) AS fired_count,
       (SELECT f.message_id FROM scheduled_fires f WHERE f.scheduled_id = s.id ORDER BY f.occurrence_at DESC LIMIT 1) AS last_message_id
  FROM scheduled_posts s`;

function wallClock(date: string, time: string): LocalDateTime {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0, hour: hour ?? 0, minute: minute ?? 0, second: second ?? 0 };
}

// The occurrence of a post on a given local date, at its local time in its zone.
function occurrenceOn(row: Pick<ScheduledRow, "time_zone" | "local_time">, date: LocalDateTime): Date {
  const { hour, minute, second } = wallClock("2000-01-01", row.local_time);
  return localToInstant(row.time_zone, { ...date, hour, minute, second });
}

// For a weekly post: the occurrence dates from a starting date, one week apart.
function weeklyFrom(row: Pick<ScheduledRow, "time_zone" | "local_time">, start: LocalDateTime, count: number): Date[] {
  return Array.from({ length: count }, (_, week) => occurrenceOn(row, addLocalDays(start, 7 * week)));
}

function upcoming(row: ScheduledRow): Date[] {
  if (row.state === "sent" || row.state === "cancelled" || row.next_fire_at === null) return [];
  if (row.repeat === "none") return [row.next_fire_at];
  return weeklyFrom(row, localParts(row.time_zone, row.next_fire_at), 3);
}

function toJson(row: ScheduledRow): ScheduledJson {
  return {
    id: row.id,
    channel_id: row.channel_id,
    text: row.text,
    state: row.state,
    repeat: row.repeat,
    local_date: row.local_date,
    local_time: row.local_time,
    time_zone: row.time_zone,
    next_fire_at: row.next_fire_at?.toISOString() ?? null,
    next_fire_local: row.next_fire_at ? localIso(row.time_zone, row.next_fire_at) : null,
    upcoming_local: upcoming(row).map((instant) => localIso(row.time_zone, instant)),
    fired_count: row.fired_count,
    last_message_id: row.last_message_id,
  };
}

export async function scheduledFor(channelId: string): Promise<ScheduledJson[]> {
  const found = await rows<ScheduledRow>(
    pool,
    `${SELECT} WHERE s.channel_id = $1 ORDER BY (s.state IN ('sent', 'cancelled')), s.next_fire_at NULLS LAST, s.created_at`,
    [channelId],
  );
  return found.map(toJson);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = wallClock(value, "00:00");
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

const validTime = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value);

export async function schedulePost(viewer: Viewer, channel: MemberChannel, value: Record<string, unknown>): Promise<ScheduledJson> {
  if (!schedules(viewer.role)) throw new ApiError("forbidden");
  const zone = viewer.workspace.time_zone;
  const errors: FieldErrors = {};
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (text === "") errors.text = FIELD.textEmpty;
  else if ([...text].length > TEXT_LIMIT) errors.text = FIELD.textLong;
  if (!validDate(value.local_date)) errors.local_date = FIELD.dateTime;
  if (!validTime(value.local_time)) errors.local_time = FIELD.dateTime;
  if (value.repeat !== "none" && value.repeat !== "weekly") errors.repeat = FIELD.repeat;
  const localTime = validTime(value.local_time) ? (value.local_time.length === 5 ? `${value.local_time}:00` : value.local_time) : "";
  const first = validDate(value.local_date) && localTime ? localToInstant(zone, wallClock(value.local_date, localTime)) : null;
  if (first && first.getTime() <= now().getTime()) errors.local_time = FIELD.timePassed(zone);
  if (Object.keys(errors).length > 0 || !first) throw invalid(errors);

  const id = randomUUID();
  await pool.query(
    `INSERT INTO scheduled_posts (id, workspace_id, channel_id, author_id, text, repeat, local_date, local_time, time_zone, state, next_fire_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'scheduled', $10, $11)`,
    [id, channel.workspace_id, channel.id, viewer.id, text, value.repeat, value.local_date, localTime, zone, first, now()],
  );
  const row = await one<ScheduledRow>(pool, `${SELECT} WHERE s.id = $1`, [id]);
  if (!row) throw new ApiError("internal_error");
  return toJson(row);
}

// Any dispatcher or operations manager in the channel may cancel while the post is scheduled.
// A post that is firing right now is locked, so the cancel answers schedule_not_pending.
export async function cancelScheduled(viewer: Viewer, id: string): Promise<ScheduledJson> {
  if (!isUuid(id)) throw new ApiError("not_found");
  const visible = await one<ScheduledRow>(
    pool,
    `${SELECT} WHERE s.id = $1 AND s.workspace_id = $2
       AND EXISTS (SELECT 1 FROM memberships m WHERE m.channel_id = s.channel_id AND m.user_id = $3)`,
    [id, viewer.workspace.id, viewer.id],
  );
  if (!visible) throw new ApiError("not_found");
  if (!schedules(viewer.role)) throw new ApiError("forbidden");
  return tx(async (client) => {
    const locked = await client
      .query<{ state: State }>("SELECT state FROM scheduled_posts WHERE id = $1 FOR UPDATE NOWAIT", [id])
      .catch((error: { code?: string }) => {
        if (error.code === "55P03") throw new ApiError("schedule_not_pending");
        throw error;
      });
    if (locked.rows[0]?.state !== "scheduled") throw new ApiError("schedule_not_pending");
    await client.query("UPDATE scheduled_posts SET state = 'cancelled', next_fire_at = NULL WHERE id = $1", [id]);
    const row = await one<ScheduledRow>(client, `${SELECT} WHERE s.id = $1`, [id]);
    if (!row) throw new ApiError("not_found");
    return toJson(row);
  });
}

// State transitions on firing: scheduled → firing → sent (one-off) or scheduled → firing →
// scheduled (weekly). Only the most recent missed occurrence fires; the scheduler must still be an active
// member, or the post is cancelled with nothing sent.
async function fireOne(id: string): Promise<void> {
  await tx(async (client) => {
    const at = now();
    const row = await one<ScheduledRow>(client, `${SELECT} WHERE s.id = $1 AND s.state = 'scheduled' AND s.next_fire_at <= $2 FOR UPDATE OF s SKIP LOCKED`, [id, at]);
    if (!row || !row.next_fire_at) return;
    await client.query("UPDATE scheduled_posts SET state = 'firing' WHERE id = $1", [id]);
    const member = await one(
      client,
      "SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.channel_id = $1 AND m.user_id = $2 AND u.status = 'active'",
      [row.channel_id, row.author_id],
    );
    if (!member) {
      await client.query("UPDATE scheduled_posts SET state = 'cancelled', next_fire_at = NULL WHERE id = $1", [id]);
      return;
    }
    let occurrence = row.next_fire_at;
    let next: Date | null = null;
    if (row.repeat === "weekly") {
      let week = localParts(row.time_zone, row.next_fire_at);
      for (;;) {
        const following = occurrenceOn(row, addLocalDays(week, 7));
        if (following.getTime() > at.getTime()) {
          next = following;
          break;
        }
        occurrence = following;
        week = addLocalDays(week, 7);
      }
    }
    const messageId = randomUUID();
    await client.query(
      `INSERT INTO messages (id, workspace_id, channel_id, author_id, via_send, text, version, sent_at, editable_until)
       VALUES ($1, $2, $3, $4, false, $5, 1, $6, $7)`,
      [messageId, row.workspace_id, row.channel_id, row.author_id, row.text, at, addSeconds(at, config.editWindowSeconds)],
    );
    await storeMessageRecords(client, { id: messageId, channelId: row.channel_id, authorId: row.author_id, text: row.text, sentAt: at });
    await client.query("INSERT INTO scheduled_fires (scheduled_id, occurrence_at, message_id, fired_at) VALUES ($1, $2, $3, $4)", [id, occurrence, messageId, at]);
    await client.query("UPDATE scheduled_posts SET state = $2, next_fire_at = $3 WHERE id = $1", [id, next ? "scheduled" : "sent", next]);
    await logEvents(client, () => createdEvents(client, row.workspace_id, row.channel_id, messageId, row.author_id, null));
  });
}

export async function fireDueScheduledPosts(): Promise<void> {
  const due = await rows<{ id: string }>(
    pool,
    "SELECT id FROM scheduled_posts WHERE state = 'scheduled' AND next_fire_at <= $1 ORDER BY next_fire_at LIMIT 50",
    [now()],
  );
  for (const post of due) await fireOne(post.id);
}
