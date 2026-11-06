import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db.js";
import type { AppConfig } from "../config.js";
import { errConflict, errNotFound, errValidation } from "../errors.js";
import { requireUser, requireRole } from "../session.js";
import { getEvent, eventObject, mapEvent, EVENT_LIST_SQL } from "../domain/repo.js";
import { canTransition, reportedStatus } from "../domain/states.js";
import { localToUtc } from "../time.js";
import { newId } from "../ids.js";
import { safeParse } from "./auth.js";
import type { EventRow } from "../domain/types.js";

const CLASS_RE = /^[A-Z0-9]{1,6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CUTOFF_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function registerEventRoutes(app: FastifyInstance, db: Db, config: AppConfig): void {
  app.get("/api/events", async (request, reply) => {
    const user = await requireUser(request);
    if (user.isOperator || !user.clubId) throw errNotFound();
    const rows = await db.query(EVENT_LIST_SQL, [user.clubId]);
    reply.send({ events: rows.map((r) => eventObject(mapEvent(r), new Date())) });
  });

  app.post("/api/events", async (request, reply) => {
    const user = await requireUser(request);
    if (user.isOperator || !user.clubId) throw errNotFound();
    requireRole(user, ["chair"]);
    const parsed = safeParse(eventInputSchema, request.body);
    if (!parsed.ok) throw errValidation(parsed.fields, "Fix these fields.");
    const value = normalizeEventInput(parsed.value);
    const tz = await clubTimeZone(db, user.clubId);
    // The cutoff is a full local date and time; it must fall before event-day midnight.
    const cutoffUtc = localToUtc(value.registrationCutoff.slice(0, 10), value.registrationCutoff.slice(11, 16), tz);
    if (cutoffUtc.getTime() >= localToUtc(value.date, "00:00", tz).getTime()) {
      throw errValidation({ registrationCutoff: "The cutoff must be before event day." });
    }
    const table = await tableForDate(db, user.clubId, value.date);
    for (const cls of value.classesInHeats()) {
      if (!(cls in table.factors)) throw errValidation({ classHeats: `Class ${cls} is not in the index table in force.` });
    }
    const eventId = newId("evt");
    await db.tx(async (client) => {
      await client.query(
        `INSERT INTO events (id, club_id, name, date, venue, registration_cutoff, runs_per_driver,
          heat_classes, stations, status, version, index_table_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',1,$10)`,
        [
          eventId, user.clubId, value.name, value.date, value.venue, cutoffUtc.toISOString(),
          value.runsPerDriver, JSON.stringify(value.heatClasses), JSON.stringify(value.stations), table.id,
        ],
      );
      await insertStations(client, eventId, value.heatClasses, value.stations);
    });
    const event = await getEvent(db, eventId, user.clubId);
    reply.status(201).send({ event: eventObject(event as EventRow, new Date()) });
  });

  app.get("/api/events/:id", async (request, reply) => {
    const user = await requireUser(request);
    if (user.isOperator || !user.clubId) throw errNotFound();
    const event = await getEvent(db, (request.params as { id: string }).id, user.clubId);
    if (!event) throw errNotFound();
    reply.send({ event: eventObject(event, new Date()) });
  });

  app.patch("/api/events/:id", async (request, reply) => {
    const user = await requireUser(request);
    requireRole(user, ["chair"]);
    const event = await getEvent(db, (request.params as { id: string }).id, user.clubId);
    if (!event) throw errNotFound();
    if (event.status !== "draft") throw errConflict("event_locked", "Only draft events can be edited.");
    const body = request.body as Record<string, unknown>;
    const version = Number(body?.version);
    if (!Number.isInteger(version) || event.version !== version) {
      throw errConflict("stale_version", "Someone else changed this event. Reload to see the latest.");
    }
    const parsed = safeParse(eventInputSchema, request.body);
    if (!parsed.ok) throw errValidation(parsed.fields, "Fix these fields.");
    const value = normalizeEventInput(parsed.value);
    const tz = event.time_zone;
    const cutoffUtc = localToUtc(value.registrationCutoff.slice(0, 10), value.registrationCutoff.slice(11, 16), tz);
    if (cutoffUtc.getTime() >= localToUtc(value.date, "00:00", tz).getTime()) {
      throw errValidation({ registrationCutoff: "The cutoff must be before event day." });
    }
    const table = await tableForDate(db, user.clubId as string, value.date);
    for (const cls of value.classesInHeats()) {
      if (!(cls in table.factors)) throw errValidation({ classHeats: `Class ${cls} is not in the index table in force.` });
    }
    await db.tx(async (client) => {
      await client.query(`DELETE FROM stations WHERE event_id = $1`, [event.id]);
      await client.query(
        `UPDATE events SET name=$1, date=$2, venue=$3, registration_cutoff=$4, runs_per_driver=$5,
          heat_classes=$6, stations=$7, version=version+1, updated_at=now(), index_table_id=$8
         WHERE id=$9`,
        [
          value.name, value.date, value.venue, cutoffUtc.toISOString(), value.runsPerDriver,
          JSON.stringify(value.heatClasses), JSON.stringify(value.stations), table.id, event.id,
        ],
      );
      await insertStations(client, event.id, value.heatClasses, value.stations);
    });
    const updated = await getEvent(db, event.id, user.clubId);
    reply.send({ event: eventObject(updated as EventRow, new Date()) });
  });

  app.post("/api/events/:id/transition", async (request, reply) => {
    const user = await requireUser(request);
    requireRole(user, ["chair"]);
    const event = await getEvent(db, (request.params as { id: string }).id, user.clubId);
    if (!event) throw errNotFound();
    const to = (request.body as { to?: string })?.to as EventRow["status"];
    const now = new Date();
    if (!to || !canTransition(reportedStatus(event.status, event.registration_cutoff, now), to)) {
      throw errConflict("illegal_transition", "That step is not available.");
    }
    if (to === "final") {
      const closes = event.protest_window_closes_at;
      if (closes && now.getTime() < closes.getTime()) {
        throw errConflict("protest_window_open", "The protest window is still open.");
      }
      const pending = await db.query(
        `SELECT id FROM protests WHERE event_id = $1 AND status = 'pending' LIMIT 1`,
        [event.id],
      );
      if (pending[0]) throw errConflict("protests_pending", "Decide every protest before setting results final.");
    }
    let runningHeat = event.running_heat;
    let provisionalAt = event.provisional_at;
    let closesAt = event.protest_window_closes_at;
    if (to === "running") runningHeat = 1;
    if (to === "provisional") {
      provisionalAt = now;
      closesAt = new Date(now.getTime() + config.protestWindowSeconds * 1000);
      runningHeat = null;
    }
    await db.query(
      `UPDATE events SET status=$1, running_heat=$2, provisional_at=$3, protest_window_closes_at=$4, updated_at=now() WHERE id=$5`,
      [to, runningHeat, provisionalAt?.toISOString() ?? null, closesAt?.toISOString() ?? null, event.id],
    );
    const updated = await getEvent(db, event.id, user.clubId);
    reply.send({ event: eventObject(updated as EventRow, now) });
  });

  app.post("/api/events/:id/running-heat", async (request, reply) => {
    const user = await requireUser(request);
    requireRole(user, ["chair", "timing"]);
    const event = await getEvent(db, (request.params as { id: string }).id, user.clubId);
    if (!event) throw errNotFound();
    if (event.status !== "running") throw errConflict("event_not_running", "The event is not running.");
    const heat = Number((request.body as { heat?: number })?.heat);
    const heatCount = Object.keys(event.heat_classes).length;
    if (!Number.isInteger(heat) || heat < 1 || heat > heatCount) {
      throw errValidation({ heat: "That heat does not exist." });
    }
    await db.query(`UPDATE events SET running_heat = $1, updated_at = now() WHERE id = $2`, [heat, event.id]);
    const updated = await getEvent(db, event.id, user.clubId);
    reply.send({ event: eventObject(updated as EventRow, new Date()) });
  });
}

const eventInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  date: z.string().regex(DATE_RE, "Use YYYY-MM-DD."),
  venue: z.string().trim().min(1).max(80),
  registrationCutoff: z.string().regex(CUTOFF_RE, "Use YYYY-MM-DDTHH:MM."),
  runsPerDriver: z.number().int().min(1).max(6),
  heats: z.number().int().min(2).max(4),
  classHeats: z.record(z.string(), z.number().int().nullable()),
  stations: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
});

class NormalizedEvent {
  constructor(
    public name: string,
    public date: string,
    public venue: string,
    public registrationCutoff: string,
    public runsPerDriver: number,
    public heatClasses: Record<string, string[]>,
    public stations: string[],
  ) {}

  classesInHeats(): string[] {
    return Object.values(this.heatClasses).flat();
  }
}

function normalizeEventInput(value: z.infer<typeof eventInputSchema>): NormalizedEvent {
  const heatClasses: Record<string, string[]> = {};
  const seen = new Set<string>();
  for (let heat = 1; heat <= value.heats; heat++) heatClasses[String(heat)] = [];
  for (const [cls, heat] of Object.entries(value.classHeats)) {
    if (heat === null || heat === undefined) continue;
    if (!CLASS_RE.test(cls)) throw errValidation({ classHeats: `Class ${cls} is not a valid class code.` });
    if (seen.has(cls)) throw errValidation({ classHeats: `Class ${cls} appears in two heats.` });
    seen.add(cls);
    const key = String(heat);
    if (!heatClasses[key]) heatClasses[key] = [];
    heatClasses[key].push(cls);
  }
  const unique = new Set(value.stations);
  if (unique.size !== value.stations.length) throw errValidation({ stations: "Station names must be unique." });
  return new NormalizedEvent(
    value.name, value.date, value.venue, value.registrationCutoff,
    value.runsPerDriver, heatClasses, value.stations,
  );
}

async function clubTimeZone(db: Db, clubId: string | null): Promise<string> {
  const rows = await db.query(`SELECT time_zone FROM clubs WHERE id = $1`, [clubId]);
  return rows[0]?.time_zone as string;
}

async function tableForDate(db: Db, clubId: string, date: string) {
  const rows = await db.query(
    `SELECT id, effective_date, factors FROM index_tables
     WHERE club_id = $1 AND effective_date <= $2::date ORDER BY effective_date DESC LIMIT 1`,
    [clubId, date],
  );
  if (!rows[0]) throw errValidation({ date: "No index table is in force on that date." });
  return { id: rows[0].id as string, effective_date: String(rows[0].effective_date), factors: rows[0].factors as Record<string, string> };
}

async function insertStations(client: { query: (sql: string, params: unknown[]) => Promise<unknown> }, eventId: string, heatClasses: Record<string, string[]>, stations: string[]): Promise<void> {
  for (const heat of Object.keys(heatClasses).map(Number).sort((a, b) => a - b)) {
    for (const name of stations) {
      await client.query(
        `INSERT INTO stations (id, event_id, name, heat) VALUES ($1,$2,$3,$4)`,
        [newId("sta"), eventId, name, heat],
      );
    }
  }
}
