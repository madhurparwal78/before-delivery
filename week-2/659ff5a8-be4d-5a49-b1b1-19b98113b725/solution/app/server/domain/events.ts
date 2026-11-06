import { z } from "zod";
import type { EventView, Heat } from "../../shared/api.js";
import { EVENT_STATUS_LABEL, type EventStatus, isLegalMove } from "../../shared/lifecycle.js";
import { tableInForce } from "../../shared/rules.js";
import { isCalendarDate, zonedToInstant } from "../../shared/time.js";
import { type ClubAuth, requireRole } from "../auth.js";
import { config } from "../config.js";
import { type Db, one, returning, rows, transaction } from "../db.js";
import { ApiError, validationError } from "../errors.js";
import { parse, text, wholeNumber } from "../validate.js";
import { loadTables } from "./indexTables.js";

export interface EventRow {
  id: number;
  club_id: number;
  name: string;
  date: string;
  venue: string;
  registration_cutoff_local: string;
  registration_cutoff_utc: Date;
  runs_per_driver: number;
  heat_count: number;
  stations: string[];
  status: EventStatus;
  running_heat: number | null;
  provisional_at: Date | null;
  protest_window_closes_at: Date | null;
  version: number;
  published_at: Date | null;
}

export async function findEvent(db: Db, clubId: number, id: number, lock = false): Promise<EventRow> {
  const row = await one<EventRow>(
    db,
    `select * from events where id = $1 and club_id = $2 ${lock ? "for update" : ""}`,
    [id, clubId],
  );
  if (!row) throw new ApiError("not_found");
  return row;
}

/** Status as reported: registration closes by itself at the cutoff, without anyone acting. */
export function reportedStatus(row: EventRow, now: Date): EventStatus {
  return row.status === "registration_open" && now >= row.registration_cutoff_utc ? "registration_closed" : row.status;
}

/** The one place that decides whether the protest window is open. */
export function protestWindowOpen(row: EventRow, now: Date): boolean {
  return row.protest_window_closes_at !== null && now < row.protest_window_closes_at;
}

/** What every event view reads besides its own row: class placements, the club's index tables and stored checksums. */
async function viewContext(db: Db, club: ClubAuth["club"], ids: number[]) {
  const classes = await rows<{ event_id: number; class_code: string; heat: number }>(
    db,
    "select event_id, class_code, heat from event_classes where event_id = any($1) order by position",
    [ids],
  );
  const tables = await loadTables(db, club.id);
  const checksums = await rows<{ event_id: number; checksum: string }>(
    db,
    `select p.event_id, p.checksum from publications p join events e on e.id = p.event_id
      where p.event_id = any($1) and e.published_at is not null`,
    [ids],
  );
  return { club, classes, tables, checksums };
}

export async function eventViews(db: Db, club: ClubAuth["club"], events: EventRow[], now: Date): Promise<EventView[]> {
  if (events.length === 0) return [];
  const context = await viewContext(db, club, events.map((e) => e.id));
  return events.map((row) => toView(context, row, now));
}

export async function eventView(db: Db, club: ClubAuth["club"], row: EventRow): Promise<EventView> {
  return toView(await viewContext(db, club, [row.id]), row, new Date());
}

function toView(
  { club, classes, tables, checksums }: Awaited<ReturnType<typeof viewContext>>,
  row: EventRow,
  now: Date,
): EventView {
  const heats: Heat[] = Array.from({ length: row.heat_count }, (_, index) => ({
    number: index + 1,
    classes: classes.filter((c) => c.event_id === row.id && c.heat === index + 1).map((c) => c.class_code),
  }));
  const table = tableInForce(tables, row.date);
  if (!table) throw new Error(`no index table is in force for event ${row.id}`);
  const status = reportedStatus(row, now);
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    venue: row.venue,
    timeZone: club.timeZone,
    registrationCutoff: row.registration_cutoff_local,
    registrationCutoffUtc: row.registration_cutoff_utc.toISOString(),
    runsPerDriver: row.runs_per_driver,
    heats,
    stations: row.stations,
    status,
    registrationOpen: status === "registration_open",
    runningHeat: row.running_heat,
    provisionalAt: row.provisional_at?.toISOString() ?? null,
    protestWindowClosesAt: row.protest_window_closes_at?.toISOString() ?? null,
    protestWindowOpen: protestWindowOpen(row, now),
    indexTable: { id: table.id, effectiveDate: table.effectiveDate },
    factors: Object.fromEntries(
      Object.entries(table.factors).filter(([code]) => heats.some((h) => h.classes.includes(code))),
    ),
    version: row.version,
    publishedAt: row.published_at?.toISOString() ?? null,
    resultsChecksum: checksums.find((c) => c.event_id === row.id)?.checksum ?? null,
    serverTime: now.toISOString(),
  };
}

const MIDNIGHT = "00:00";
const CUTOFF = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const eventFields = z.object({
  name: text("Event name", 80),
  date: z.string({ error: "Enter the date as YYYY-MM-DD." }).refine(isCalendarDate, "Enter the date as YYYY-MM-DD."),
  venue: text("Venue", 80),
  registrationCutoff: z
    .string({ error: "Enter the cutoff as YYYY-MM-DDTHH:MM." })
    .regex(CUTOFF, "Enter the cutoff as YYYY-MM-DDTHH:MM."),
  runsPerDriver: wholeNumber("Runs per driver", 1, 6),
  heats: z.array(
    z.object({ number: z.number().int(), classes: z.array(z.string()) }),
    { error: "Assign every class to a heat." },
  ),
  stations: z
    .array(text("Station", 40), { error: "List the stations." })
    .min(1, "List at least one station.")
    .max(20, "List at most 20 stations."),
});

type EventInput = z.infer<typeof eventFields>;

const patchSchema = eventFields.partial().extend({ version: wholeNumber("Version", 1, 2_147_483_647) });

/** Rules that need the index table in force or more than one field. */
async function checkEvent(db: Db, clubId: number, input: EventInput): Promise<void> {
  const problems: Record<string, string> = {};
  const table = tableInForce(await loadTables(db, clubId), input.date);
  if (!table) problems["date"] = "No index table is in force on that date.";
  if (input.registrationCutoff >= `${input.date}T${MIDNIGHT}`) {
    problems["registrationCutoff"] = "The cutoff must be before the event date.";
  }
  if (input.heats.length < 2 || input.heats.length > 4) problems["heats"] = "An event needs 2 to 4 heats.";
  else if (input.heats.some((h, index) => h.number !== index + 1)) {
    problems["heats"] = `Heats must be numbered 1 to ${input.heats.length}.`;
  } else {
    const seen = new Set<string>();
    for (const code of input.heats.flatMap((h) => h.classes)) {
      if (table && !(code in table.factors)) {
        problems["heats"] = `Class ${code} is not in the index table in force on ${input.date}.`;
      } else if (seen.has(code)) problems["heats"] = `Class ${code} is in two heats.`;
      seen.add(code);
    }
  }
  if (new Set(input.stations).size !== input.stations.length) problems["stations"] = "Station names must be unique.";
  if (Object.keys(problems).length > 0) throw validationError(problems);
}

export async function insertEvent(db: Db, club: { id: number; timeZone: string }, input: EventInput): Promise<number> {
  const created = await returning<{ id: number }>(
    db,
    `insert into events (club_id, name, date, venue, registration_cutoff_local, registration_cutoff_utc,
                         runs_per_driver, heat_count, stations)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [
      club.id,
      input.name,
      input.date,
      input.venue,
      input.registrationCutoff,
      zonedToInstant(input.registrationCutoff, club.timeZone),
      input.runsPerDriver,
      input.heats.length,
      input.stations,
    ],
  );
  await writeSetup(db, created.id, input);
  return created.id;
}

async function writeSetup(db: Db, eventId: number, input: EventInput): Promise<void> {
  let position = 0;
  for (const heat of input.heats) {
    for (const code of heat.classes) {
      position += 1;
      await db.query("insert into event_classes (event_id, class_code, heat, position) values ($1, $2, $3, $4)", [
        eventId,
        code,
        heat.number,
        position,
      ]);
    }
    for (const [index, name] of input.stations.entries()) {
      await db.query("insert into stations (event_id, heat, name, position) values ($1, $2, $3, $4)", [
        eventId,
        heat.number,
        name,
        index + 1,
      ]);
    }
  }
}

export async function createEvent(auth: ClubAuth, body: unknown): Promise<EventView> {
  requireRole(auth, "chair");
  return transaction(async (db) => {
    const input = parse(eventFields, body);
    await checkEvent(db, auth.club.id, input);
    const id = await insertEvent(db, auth.club, input);
    return eventView(db, auth.club, await findEvent(db, auth.club.id, id));
  });
}

async function currentInput(db: Db, row: EventRow): Promise<EventInput> {
  const classes = await rows<{ class_code: string; heat: number }>(
    db,
    "select class_code, heat from event_classes where event_id = $1 order by position",
    [row.id],
  );
  return {
    name: row.name,
    date: row.date,
    venue: row.venue,
    registrationCutoff: row.registration_cutoff_local,
    runsPerDriver: row.runs_per_driver,
    heats: Array.from({ length: row.heat_count }, (_, index) => ({
      number: index + 1,
      classes: classes.filter((c) => c.heat === index + 1).map((c) => c.class_code),
    })),
    stations: row.stations,
  };
}

export async function patchEvent(auth: ClubAuth, id: number, body: unknown): Promise<EventView> {
  return transaction(async (db) => {
    const row = await findEvent(db, auth.club.id, id, true);
    requireRole(auth, "chair");
    if (row.status !== "draft") throw new ApiError("event_locked");
    const version = typeof body === "object" && body !== null && "version" in body ? body.version : undefined;
    if (typeof version === "number" && version !== row.version) throw new ApiError("stale_version");
    const patch = parse(patchSchema, body);
    const input: EventInput = { ...(await currentInput(db, row)), ...withoutVersion(patch) };
    await checkEvent(db, auth.club.id, input);
    await db.query("delete from event_classes where event_id = $1", [id]);
    await db.query("delete from stations where event_id = $1", [id]);
    await db.query(
      `update events set name = $2, date = $3, venue = $4, registration_cutoff_local = $5,
              registration_cutoff_utc = $6, runs_per_driver = $7, heat_count = $8, stations = $9, version = version + 1
        where id = $1`,
      [
        id,
        input.name,
        input.date,
        input.venue,
        input.registrationCutoff,
        zonedToInstant(input.registrationCutoff, auth.club.timeZone),
        input.runsPerDriver,
        input.heats.length,
        input.stations,
      ],
    );
    await writeSetup(db, id, input);
    return eventView(db, auth.club, await findEvent(db, auth.club.id, id));
  });
}

function withoutVersion(patch: z.infer<typeof patchSchema>): Partial<EventInput> {
  const { version: _version, ...fields } = patch;
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

const transitionSchema = z.object({ to: z.string({ error: "Name the status to move to." }) });

/** The only place event status is written, apart from publish. */
export async function writeEventStatus(db: Db, id: number, to: string): Promise<void> {
  await db.query(
    `update events set status = $2,
            running_heat = case $2 when 'running' then 1 when 'provisional' then null else running_heat end,
            provisional_at = case $2 when 'provisional' then now() else provisional_at end,
            protest_window_closes_at = case $2 when 'provisional' then now() + make_interval(secs => $3)
                                       else protest_window_closes_at end
      where id = $1`,
    [id, to, config.protestWindowSeconds],
  );
}

export async function transitionEvent(auth: ClubAuth, id: number, body: unknown): Promise<EventView> {
  return transaction(async (db) => {
    const row = await findEvent(db, auth.club.id, id, true);
    requireRole(auth, "chair");
    const { to } = parse(transitionSchema, body);
    const from = reportedStatus(row, new Date());
    if (!isLegalMove(from, to)) {
      throw new ApiError("illegal_transition", `That step is not available from ${EVENT_STATUS_LABEL[from]}.`);
    }
    if (to === "final") {
      if (protestWindowOpen(row, new Date())) throw new ApiError("protest_window_open");
      const pending = await one(db, "select 1 from protests where event_id = $1 and status = 'pending'", [id]);
      if (pending) throw new ApiError("protests_pending");
    }
    await writeEventStatus(db, id, to);
    return eventView(db, auth.club, await findEvent(db, auth.club.id, id));
  });
}

const heatSchema = z.object({ heat: wholeNumber("Heat", 1, 4) });

export async function setRunningHeat(auth: ClubAuth, id: number, body: unknown): Promise<EventView> {
  return transaction(async (db) => {
    const row = await findEvent(db, auth.club.id, id, true);
    requireRole(auth, "timing");
    if (reportedStatus(row, new Date()) !== "running") throw new ApiError("event_not_running");
    const { heat } = parse(heatSchema, body);
    if (heat > row.heat_count) throw validationError({ heat: `Choose a heat from 1 to ${row.heat_count}.` });
    await db.query("update events set running_heat = $2 where id = $1", [id, heat]);
    return eventView(db, auth.club, await findEvent(db, auth.club.id, id));
  });
}
