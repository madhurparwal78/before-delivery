import type { Zone } from "../shared/protocol.js";
import { worldNow } from "./clock.js";
import { config } from "./config.js";
import { one, query, tx } from "./db.js";
import { conflict, invalid, notFound, reply, Router, text, textLength, whole, type Reply } from "./http.js";
import { absoluteUrl, enqueueMail } from "./mail.js";
import { newId, type Person } from "./people.js";
import { formatInstant, localText, NOTE_TEXT, resolveLocal, START_PATTERN } from "./zones.js";

const WEEK = 7 * 86_400_000;
const OPENS_BEFORE = 15 * 60_000;
const LISTED = 8;

interface GatheringRow {
  id: string;
  community_id: string;
  title: string;
  starts_local: string;
  duration_minutes: number;
  recurrence: "none" | "weekly";
  attend_limit: number;
}

type Status = "upcoming" | "open" | "ended";

interface Occurrence {
  startsAt: Date;
  note: "missing" | "repeated" | null;
  status: Status;
}

/** upcoming until 15 minutes before the start, open until the end, then ended; by the world's clock. */
function statusAt(startsAt: Date, durationMinutes: number, now: Date): Status {
  if (now.getTime() < startsAt.getTime() - OPENS_BEFORE) return "upcoming";
  return now.getTime() < startsAt.getTime() + durationMinutes * 60_000 ? "open" : "ended";
}

function occurrence(g: GatheringRow, zone: Zone, index: number, now: Date): Occurrence {
  const [, year, month, day, hour, minute] = (START_PATTERN.exec(g.starts_local) ?? []).map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 7 * index));
  const resolved = resolveLocal(zone, date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour ?? 0, minute ?? 0);
  return { ...resolved, status: statusAt(resolved.startsAt, g.duration_minutes, now) };
}

/** Up to 8 occurrences from the earliest not ended; a one-off always lists its one. */
function occurrencesOf(g: GatheringRow, zone: Zone, now: Date): Occurrence[] {
  if (g.recurrence === "none") return [occurrence(g, zone, 0, now)];
  const first = occurrence(g, zone, 0, now);
  let index = Math.max(0, Math.floor((now.getTime() - first.startsAt.getTime() - g.duration_minutes * 60_000) / WEEK) - 1);
  while (occurrence(g, zone, index, now).status === "ended") index += 1;
  return Array.from({ length: LISTED }, (_, step) => occurrence(g, zone, index + step, now));
}

async function gatheringView(g: GatheringRow, zone: Zone, viewer: Person): Promise<Record<string, unknown>> {
  const now = await worldNow(viewer.worldId);
  const listed = occurrencesOf(g, zone, now).map((item) => ({
    startsAt: item.startsAt.toISOString(),
    startsLocal: localText(zone, item.startsAt),
    display: formatInstant(viewer.timeZone, item.startsAt),
    status: item.status,
    note: item.note ? NOTE_TEXT[item.note] : null,
  }));
  const attending = await query<{ person_id: string }>("SELECT person_id FROM attendees WHERE gathering_id = $1", [g.id]);
  return {
    id: g.id,
    communityId: g.community_id,
    title: g.title,
    durationMinutes: g.duration_minutes,
    recurrence: g.recurrence,
    limit: g.attend_limit,
    attendingCount: attending.length,
    attending: attending.some((row) => row.person_id === viewer.id),
    status: listed[0]?.status,
    display: listed[0]?.display,
    occurrences: listed,
  };
}

const GATHERING_COLUMNS = "g.id, g.community_id, g.title, g.starts_local, g.duration_minutes, g.recurrence, g.attend_limit";

interface Community {
  id: string;
  name: string;
  timeZone: Zone;
  role: "owner" | "steward" | "member";
}

/** The caller's community, or 404: another community's id is never found. */
export async function memberCommunity(id: string, person: Person): Promise<Community> {
  const row = await one<{ id: string; name: string; time_zone: Zone; role: Community["role"] }>(
    `SELECT c.id, c.name, c.time_zone, m.role FROM communities c JOIN community_members m ON m.community_id = c.id
     WHERE c.id = $1 AND c.world_id = $2 AND m.person_id = $3`,
    [id, person.worldId, person.id],
  );
  if (!row) throw notFound();
  return { id: row.id, name: row.name, timeZone: row.time_zone, role: row.role };
}

export function gatheringRoutes(router: Router<Person>): void {
  router.add("GET", "/api/communities/:id/gatherings", async (ctx, person): Promise<Reply> => {
    const community = await memberCommunity(ctx.params.id ?? "", person);
    const rows = await query<GatheringRow>(`SELECT ${GATHERING_COLUMNS} FROM gatherings g WHERE g.community_id = $1 ORDER BY g.created_at, g.id`, [community.id]);
    const gatherings = await Promise.all(rows.map((row) => gatheringView(row, community.timeZone, person)));
    return reply(200, { gatherings, total: gatherings.length });
  });

  router.add("POST", "/api/communities/:id/gatherings", async (ctx, person): Promise<Reply> => {
    const community = await memberCommunity(ctx.params.id ?? "", person);
    if (community.role === "member") throw notFound();
    const body = ctx.json();
    const title = (text(body.title) ?? "").trim();
    const starts = text(body.startsLocal) ?? "";
    const duration = whole(body.durationMinutes);
    const limit = whole(body.limit);
    if (textLength(title) < 1 || textLength(title) > 120) throw invalid("Give the gathering a title of 1 to 120 characters.");
    const parts = START_PATTERN.exec(starts)?.slice(1).map(Number);
    if (!parts || !realLocal(parts)) throw invalid("Enter the start as a local date and time.");
    if (duration === null || duration < 15 || duration > 480) throw invalid("Duration must be 15 to 480 minutes.");
    if (body.recurrence !== "none" && body.recurrence !== "weekly") throw invalid("Choose none or weekly.");
    if (limit === null || limit < 1 || limit > 500) throw invalid("Limit must be 1 to 500.");
    const id = newId();
    await query("INSERT INTO gatherings (id, community_id, title, starts_local, duration_minutes, recurrence, attend_limit) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
      id,
      community.id,
      title,
      starts,
      duration,
      body.recurrence,
      limit,
    ]);
    const row = await one<GatheringRow>(`SELECT ${GATHERING_COLUMNS} FROM gatherings g WHERE g.id = $1`, [id]);
    return reply(201, await gatheringView(row as GatheringRow, community.timeZone, person));
  });

  router.add("GET", "/api/gatherings/:id", async (ctx, person): Promise<Reply> => {
    const row = await one<GatheringRow>(`SELECT ${GATHERING_COLUMNS} FROM gatherings g WHERE g.id = $1`, [ctx.params.id ?? ""]);
    if (!row) throw notFound();
    const community = await memberCommunity(row.community_id, person);
    return reply(200, await gatheringView(row, community.timeZone, person));
  });

  router.add("POST", "/api/communities/:id/gatherings/:gatheringId/attend", async (ctx, person): Promise<Reply> => {
    const community = await memberCommunity(ctx.params.id ?? "", person);
    const count = await tx(async (client) => {
      const row = await one<GatheringRow>(
        `SELECT ${GATHERING_COLUMNS} FROM gatherings g WHERE g.id = $1 AND g.community_id = $2 FOR UPDATE`,
        [ctx.params.gatheringId ?? "", community.id],
        client,
      );
      if (!row) throw notFound();
      const attending = (await query<{ person_id: string }>("SELECT person_id FROM attendees WHERE gathering_id = $1", [row.id], client)).map((r) => r.person_id);
      if (attending.includes(person.id)) return attending.length;
      const now = await worldNow(person.worldId, client);
      if (row.recurrence === "none" && occurrence(row, community.timeZone, 0, now).status === "ended") throw conflict("This gathering has ended.");
      if (attending.length >= row.attend_limit) throw conflict("This gathering is full.");
      await query("INSERT INTO attendees (gathering_id, person_id) VALUES ($1, $2)", [row.id, person.id], client);
      return attending.length + 1;
    });
    return reply(200, { attending: true, count });
  });

  router.add("DELETE", "/api/communities/:id/gatherings/:gatheringId/attend", async (ctx, person): Promise<Reply> => {
    const community = await memberCommunity(ctx.params.id ?? "", person);
    const row = await one<{ id: string }>("SELECT id FROM gatherings WHERE id = $1 AND community_id = $2", [ctx.params.gatheringId ?? "", community.id]);
    if (!row) throw notFound();
    await query("DELETE FROM attendees WHERE gathering_id = $1 AND person_id = $2", [row.id, person.id]);
    const left = await one<{ count: number }>("SELECT count(*) AS count FROM attendees WHERE gathering_id = $1", [row.id]);
    return reply(200, { attending: false, count: left?.count ?? 0 });
  });
}

function realLocal([year, month, day, hour, minute]: number[]): boolean {
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return date.getUTCMonth() === (month ?? 1) - 1 && date.getUTCDate() === day && (hour ?? 0) < 24 && (minute ?? 0) < 60;
}

interface DueRow extends GatheringRow {
  world_id: string;
  community_zone: Zone;
}

/** Mails each attending person once per occurrence at the lead time; one that has already started sends nothing. */
export async function sendDueReminders(worldId?: string): Promise<void> {
  const rows = await query<DueRow>(
    `SELECT ${GATHERING_COLUMNS}, c.world_id, c.time_zone AS community_zone FROM gatherings g JOIN communities c ON c.id = g.community_id
     WHERE ($1::text IS NULL OR c.world_id = $1) AND EXISTS (SELECT 1 FROM attendees a WHERE a.gathering_id = g.id)`,
    [worldId ?? null],
  );
  for (const row of rows) {
    const now = await worldNow(row.world_id);
    for (const item of occurrencesOf(row, row.community_zone, now)) {
      const due = item.startsAt.getTime() - config.reminderLeadMinutes * 60_000;
      if (now.getTime() < due || now.getTime() >= item.startsAt.getTime()) continue;
      const people = await query<{ id: string; email: string; time_zone: Zone }>(
        "SELECT p.id, p.email, p.time_zone FROM attendees a JOIN people p ON p.id = a.person_id WHERE a.gathering_id = $1",
        [row.id],
      );
      for (const person of people) {
        await tx(async (client) => {
          const claimed = await one(
            "INSERT INTO reminders (gathering_id, starts_at, person_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING person_id",
            [row.id, item.startsAt, person.id],
            client,
          );
          if (!claimed) return;
          const display = formatInstant(person.time_zone, item.startsAt);
          await enqueueMail(
            person.email,
            `Starting soon: ${row.title}`,
            `${row.title} starts ${display}.\n${absoluteUrl(undefined, `/gatherings/${row.id}`)}`,
            client,
          );
        });
      }
    }
  }
}
