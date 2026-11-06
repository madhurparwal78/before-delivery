import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db.js";
import type { AppConfig } from "../config.js";
import { errConflict, errDependency, errForbidden, errNotFound, errValidation } from "../errors.js";
import { requireUser, requireRole } from "../session.js";
import { getEvent, getRegistration, mapRegistration } from "../domain/repo.js";
import { registrationIsOpen, reportedStatus } from "../domain/states.js";
import { Storage } from "../services/storage.js";
import { Renderer } from "../services/renderer.js";
import { EmailService } from "../services/emails.js";
import { waiverHtml } from "../services/pdf.js";
import { newId } from "../ids.js";
import { safeParse } from "./auth.js";
import type { EventRow, RegistrationRow } from "../domain/types.js";

export interface Services {
  storage: Storage;
  renderer: Renderer;
  emails: EmailService;
  config: AppConfig;
}

export function registrationObject(reg: RegistrationRow): Record<string, unknown> {
  return {
    id: reg.id,
    eventId: reg.event_id,
    driver: { id: reg.driver_id, name: reg.driver_name },
    classCode: reg.class_code,
    carNumber: reg.car_number,
    carDescription: reg.car_description,
    runHeat: reg.run_heat,
    checkedIn: reg.checked_in_at !== null,
    checkedInAt: reg.checked_in_at ? reg.checked_in_at.toISOString() : null,
    waiver: reg.waiver_key ? { key: reg.waiver_key, checksum: reg.waiver_checksum } : null,
    station: reg.station_id ? { id: reg.station_id, name: reg.station_name, heat: reg.station_heat } : null,
    confirmationEmail: reg.confirmation_email,
  };
}

export function registerRegistrationRoutes(app: FastifyInstance, db: Db, services: Services): void {
  app.get("/api/events/:id/registrations", async (request, reply) => {
    const user = await requireUser(request);
    if (user.isOperator || !user.clubId) throw errNotFound();
    const event = await getEvent(db, (request.params as { id: string }).id, user.clubId);
    if (!event) throw errNotFound();
    const regs = await db.query(
      `SELECT r.*, u.name AS driver_name, u.email AS driver_email,
              s.id AS station_id, s.name AS station_name, s.heat AS station_heat
       FROM registrations r
       JOIN users u ON u.id = r.driver_id
       LEFT JOIN stations s ON s.registration_id = r.id
       WHERE r.event_id = $1 ORDER BY r.class_code, r.car_number`,
      [event.id],
    );
    reply.send({ registrations: regs.map(mapRegistration).map(registrationObject) });
  });

  app.post("/api/events/:id/registrations", async (request, reply) => {
    const user = await requireUser(request);
    if (user.isOperator || !user.clubId) throw errNotFound();
    const event = await getEvent(db, (request.params as { id: string }).id, user.clubId);
    if (!event) throw errNotFound();
    const now = new Date();
    const status = reportedStatus(event.status, event.registration_cutoff, now);
    if (!registrationIsOpen(status, event.registration_cutoff, now) || status !== "registration_open") {
      throw errConflict("registration_closed", "Registration for this event is closed.");
    }
    const schema = z.object({
      classCode: z.string().regex(/^[A-Z0-9]{1,6}$/),
      carNumber: z.number().int().min(1).max(999),
      carDescription: z.string().trim().min(1).max(80),
    });
    const parsed = safeParse(schema, request.body);
    if (!parsed.ok) throw errValidation(parsed.fields, "Fix these fields.");

    const runHeat = heatForClass(event, parsed.value.classCode);
    if (runHeat === null) throw errValidation({ classCode: "This event does not run that class." });

    const existing = await db.query(
      `SELECT id FROM registrations WHERE event_id = $1 AND driver_id = $2`,
      [event.id, user.id],
    );
    if (existing[0]) throw errConflict("already_registered", "You are already registered for this event.");

    const regId = newId("reg");
    try {
      await db.query(
        `INSERT INTO registrations (id, event_id, driver_id, class_code, car_number, car_description, run_heat)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [regId, event.id, user.id, parsed.value.classCode, parsed.value.carNumber, parsed.value.carDescription, runHeat],
      );
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        // Either the same driver raced another registration, or the car number lost a race.
        const again = await db.query(
          `SELECT id FROM registrations WHERE event_id = $1 AND driver_id = $2`,
          [event.id, user.id],
        );
        if (again[0]) throw errConflict("already_registered", "You are already registered for this event.");
        throw errConflict("car_number_taken", `Car ${parsed.value.carNumber} is already taken in ${parsed.value.classCode}.`);
      }
      throw e;
    }
    const reg = await getRegistration(db, regId, user.clubId);
    // Confirmation email, sent after the record is saved; failure stays pending.
    await services.emails.queue(
      event.club_id, "registration", reg?.driver_email ?? "",
      `Registered for ${event.name}: car ${parsed.value.carNumber} ${parsed.value.classCode}`,
      `Car ${parsed.value.carNumber} ${parsed.value.classCode}\nRun heat ${runHeat}`,
      { registrationId: regId, eventId: event.id },
    );
    const fresh = await getRegistration(db, regId, user.clubId);
    reply.status(201).send({ registration: registrationObject(fresh as RegistrationRow) });
  });

  app.delete("/api/registrations/:id", async (request, reply) => {
    const user = await requireUser(request);
    const reg = await getRegistration(db, (request.params as { id: string }).id, user.clubId);
    if (!reg) throw errNotFound();
    const event = await getEvent(db, reg.event_id, user.clubId);
    if (!event) throw errNotFound();
    const isChair = user.roles.includes("chair");
    if (reg.driver_id !== user.id && !isChair) throw errNotFound();
    const status = reportedStatus(event.status, event.registration_cutoff, new Date());
    if (status !== "registration_open" && status !== "registration_closed") {
      throw errConflict("withdrawal_closed", "Withdrawal closed once the event starts.");
    }
    await db.tx(async (client) => {
      await client.query(`UPDATE stations SET registration_id = NULL WHERE registration_id = $1`, [reg.id]);
      await client.query(`DELETE FROM registrations WHERE id = $1`, [reg.id]);
    });
    reply.status(204).send();
  });

  app.post("/api/registrations/:id/check-in", async (request, reply) => {
    const user = await requireUser(request);
    const reg = await getRegistration(db, (request.params as { id: string }).id, user.clubId);
    if (!reg) throw errNotFound();
    const event = await getEvent(db, reg.event_id, user.clubId);
    if (!event) throw errNotFound();
    const isChair = user.roles.includes("chair");
    if (reg.driver_id !== user.id && !isChair) throw errNotFound();
    const status = reportedStatus(event.status, event.registration_cutoff, new Date());
    if (status !== "registration_closed" && status !== "running") {
      throw errConflict("check_in_closed", "Check-in is closed.");
    }
    if (reg.checked_in_at) throw errConflict("already_checked_in", "Already checked in.");
    const schema = z.object({ signature: z.string().min(1) });
    const parsed = safeParse(schema, request.body);
    if (!parsed.ok) throw errValidation(parsed.fields, "Fix these fields.");
    if (parsed.value.signature.trim().toLowerCase() !== reg.driver_name.trim().toLowerCase()) {
      throw errValidation({ signature: "Type your name exactly as registered." });
    }

    // Render and store the waiver first; only then mark checked in.
    const club = await clubOf(db, event.club_id);
    const key = `clubs/${club.slug}/events/${event.id}/waivers/${reg.id}.pdf`;
    const at = new Date();
    let pdf: Buffer;
    try {
      pdf = await services.renderer.renderPdf(waiverHtml(club.name, event, reg, parsed.value.signature, at));
    } catch {
      await recordFailure(db, event.club_id, event.id, "renderer");
      throw errDependency("renderer_unavailable", "Waiver signing is unavailable right now. Check in at the registration table.");
    }
    let checksum: string;
    try {
      checksum = await services.storage.putOnce(key, pdf, "application/pdf");
    } catch {
      await recordFailure(db, event.club_id, event.id, "storage");
      throw errDependency("storage_unavailable", "We could not save your signed waiver. You are not checked in yet; try again shortly.");
    }
    await db.query(
      `UPDATE registrations SET checked_in_at = $1, waiver_key = $2, waiver_checksum = $3 WHERE id = $4`,
      [at.toISOString(), key, checksum, reg.id],
    );
    const fresh = await getRegistration(db, reg.id, user.clubId);
    reply.status(201).send({ registration: registrationObject(fresh as RegistrationRow) });
  });

  app.get("/api/registrations/:id/waiver.pdf", async (request, reply) => {
    const user = await requireUser(request);
    const reg = await getRegistration(db, (request.params as { id: string }).id, user.clubId);
    if (!reg || !reg.waiver_key || !reg.checked_in_at) throw errNotFound();
    const object = await services.storage.get(reg.waiver_key);
    if (!object) throw errNotFound();
    reply.header("content-type", "application/pdf");
    reply.send(object.bytes);
  });

  // --- Rota ---
  app.get("/api/events/:id/rota", async (request, reply) => {
    const user = await requireUser(request);
    if (user.isOperator || !user.clubId) throw errNotFound();
    const event = await getEvent(db, (request.params as { id: string }).id, user.clubId);
    if (!event) throw errNotFound();
    const stations = await db.query(
      `SELECT s.id, s.name, s.heat, s.registration_id,
              r.car_number, r.class_code, u.name AS worker_name
       FROM stations s
       LEFT JOIN registrations r ON r.id = s.registration_id
       LEFT JOIN users u ON u.id = r.driver_id
       WHERE s.event_id = $1 ORDER BY s.heat, s.name`,
      [event.id],
    );
    const heats = Object.keys(event.heat_classes).map(Number).sort((a, b) => a - b).map((number) => {
      const list = stations.filter((s) => s.heat === number);
      return {
        number,
        unfilled: list.filter((s) => !s.registration_id).length,
        stations: list.map((s) => ({
          id: s.id as string,
          name: s.name as string,
          worker: s.registration_id
            ? {
                registrationId: s.registration_id as string,
                driverName: s.worker_name as string,
                carNumber: s.car_number as number,
                classCode: s.class_code as string,
              }
            : null,
        })),
      };
    });
    reply.send({ heats });
  });

  app.post("/api/stations/:id/claim", async (request, reply) => {
    const user = await requireUser(request);
    const station = await findStation(db, (request.params as { id: string }).id, user.clubId);
    if (!station) throw errNotFound();
    const event = await getEvent(db, station.event_id, user.clubId);
    if (!event) throw errNotFound();
    const status = reportedStatus(event.status, event.registration_cutoff, new Date());
    if (!["registration_open", "registration_closed", "running"].includes(status)) {
      throw errConflict("rota_locked", "The rota is locked.");
    }
    const reg = await rotaGuard(db, event, user.id, station.heat);
    await fillStation(db, services, event, station, reg, reply);
  });

  app.post("/api/stations/:id/assign", async (request, reply) => {
    const user = await requireUser(request);
    if (user.isOperator) throw errForbidden();
    requireRole(user, ["chair", "workers"]);
    const station = await findStation(db, (request.params as { id: string }).id, user.clubId);
    if (!station) throw errNotFound();
    const event = await getEvent(db, station.event_id, user.clubId);
    if (!event) throw errNotFound();
    const schema = z.object({ registrationId: z.string().min(1) });
    const parsed = safeParse(schema, request.body);
    if (!parsed.ok) throw errValidation(parsed.fields, "Fix these fields.");
    const status = reportedStatus(event.status, event.registration_cutoff, new Date());
    if (!["registration_open", "registration_closed", "running"].includes(status)) {
      throw errConflict("rota_locked", "The rota is locked.");
    }
    const reg = await getRegistration(db, parsed.value.registrationId, user.clubId);
    if (!reg || reg.event_id !== event.id) throw errNotFound();
    const guard = await rotaGuard(db, event, reg.driver_id, station.heat, reg);
    await fillStation(db, services, event, station, guard, reply);
  });

  app.delete("/api/stations/:id/claim", async (request, reply) => {
    const user = await requireUser(request);
    const station = await findStation(db, (request.params as { id: string }).id, user.clubId);
    if (!station) throw errNotFound();
    const event = await getEvent(db, station.event_id, user.clubId);
    if (!event) throw errNotFound();
    const isWorkerChief = user.roles.some((r) => ["chair", "workers"].includes(r));
    if (!isWorkerChief) {
      // Only the worker on it may release.
      const reg = station.registration_id ? await getRegistration(db, station.registration_id, user.clubId) : null;
      if (!reg || reg.driver_id !== user.id) throw errNotFound();
    }
    const status = reportedStatus(event.status, event.registration_cutoff, new Date());
    if (!["registration_open", "registration_closed", "running"].includes(status)) {
      throw errConflict("rota_locked", "The rota is locked.");
    }
    if (!station.registration_id) throw errConflict("station_open", "That station is already open.");
    await db.query(`UPDATE stations SET registration_id = NULL WHERE id = $1`, [station.id]);
    reply.status(204).send();
  });
}

function heatForClass(event: EventRow, classCode: string): number | null {
  for (const [heat, classes] of Object.entries(event.heat_classes)) {
    if (classes.includes(classCode)) return Number(heat);
  }
  return null;
}

interface StationLite {
  id: string;
  event_id: string;
  name: string;
  heat: number;
  registration_id: string | null;
}

async function findStation(db: Db, stationId: string, clubId: string | null): Promise<StationLite | null> {
  const rows = await db.query(
    `SELECT s.id, s.event_id, s.name, s.heat, s.registration_id, e.club_id
     FROM stations s JOIN events e ON e.id = s.event_id WHERE s.id = $1`,
    [stationId],
  );
  const row = rows[0];
  if (!row) return null;
  if (clubId !== null && row.club_id !== clubId) return null;
  return {
    id: row.id as string,
    event_id: row.event_id as string,
    name: row.name as string,
    heat: row.heat as number,
    registration_id: (row.registration_id as string | null) ?? null,
  };
}

/** The published 409 order for claims and assignments. */
async function rotaGuard(db: Db, event: EventRow, driverId: string, heat: number, reg?: RegistrationRow): Promise<RegistrationRow> {
  if (!reg) {
    const rows = await db.query(
      `SELECT r.*, u.name AS driver_name, u.email AS driver_email
       FROM registrations r JOIN users u ON u.id = r.driver_id
       WHERE r.event_id = $1 AND r.driver_id = $2`,
      [event.id, driverId],
    );
    if (!rows[0]) throw errConflict("not_registered", "You are not registered for this event.");
    reg = mapRegistration(rows[0]);
  }
  const held = await db.query(
    `SELECT s.id FROM stations s JOIN registrations r ON r.id = s.registration_id
     WHERE s.event_id = $1 AND r.driver_id = $2`,
    [event.id, driverId],
  );
  if (held[0]) throw errConflict("already_assigned", "You already have a work station for this event.");
  if (reg.run_heat === heat) {
    throw errConflict("own_heat", `You drive in heat ${heat}. Pick a station in another heat.`);
  }
  return reg;
}

async function fillStation(
  db: Db,
  services: Services,
  event: EventRow,
  station: StationLite,
  reg: RegistrationRow,
  reply: unknown,
): Promise<void> {
  const result = await db.query(
    `UPDATE stations SET registration_id = $1 WHERE id = $2 AND registration_id IS NULL RETURNING id`,
    [reg.id, station.id],
  );
  if (!result[0]) {
    throw errConflict("station_taken", "That station was just taken. Pick another.");
  }
  await services.emails.queue(
    event.club_id, "assignment", reg.driver_email,
    `Work assignment for ${event.name}: ${station.name}, heat ${station.heat}`,
    `Station ${station.name}\nHeat ${station.heat}\nEvent date ${event.date}`,
    { registrationId: reg.id, eventId: event.id },
  );
  const r = reply as { status: (code: number) => { send: (body: unknown) => void } };
  const fresh = await getRegistration(db, reg.id, null);
  r.status(201).send({
    station: { id: station.id, name: station.name, heat: station.heat },
    registration: registrationObject(fresh as RegistrationRow),
  });
}

async function recordFailure(db: Db, clubId: string, eventId: string, service: "renderer" | "storage" | "mail"): Promise<void> {
  await db.query(
    `INSERT INTO delivery_failures (id, club_id, event_id, service) VALUES ($1,$2,$3,$4)`,
    [newId("fail"), clubId, eventId, service],
  );
}

async function clubOf(db: Db, clubId: string): Promise<{ slug: string; name: string }> {
  const rows = await db.query(`SELECT slug, name FROM clubs WHERE id = $1`, [clubId]);
  return { slug: rows[0].slug as string, name: rows[0].name as string };
}
