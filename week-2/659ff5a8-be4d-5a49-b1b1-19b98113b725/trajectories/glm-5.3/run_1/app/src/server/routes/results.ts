import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db.js";
import type { AppConfig } from "../config.js";
import { errConflict, errDependency, errNotFound, errValidation } from "../errors.js";
import { requireUser, requireRole } from "../session.js";
import { getEvent } from "../domain/repo.js";
import { reportedStatus, protestWindowOpen, CORRECTION_STATUSES } from "../domain/states.js";
import { computeStandings, orderRows, loadEntries, type StandingsEntry } from "../domain/standings.js";
import { newId } from "../ids.js";
import { safeParse } from "./auth.js";
import { Storage } from "../services/storage.js";
import { Renderer } from "../services/renderer.js";
import { resultsHtml, type ResultsLine } from "../services/pdf.js";
import { Mailer } from "../services/mailer.js";
import { resultsEmailBody } from "../services/emails.js";
import type { EventRow } from "../domain/types.js";

export interface PublishServices {
  storage: Storage;
  renderer: Renderer;
  mailer: Mailer;
  config: AppConfig;
}

export function registerResultsRoutes(app: FastifyInstance, db: Db, services: PublishServices): void {
  // --- Standings ---
  app.get("/api/events/:id/standings", async (request, reply) => {
    const user = await requireUser(request);
    if (user.isOperator || !user.clubId) throw errNotFound();
    const event = await getEvent(db, (request.params as { id: string }).id, user.clubId);
    if (!event) throw errNotFound();
    const query = request.query as { view?: string; class?: string };
    const view = (query.view ?? "indexed") as "indexed" | "class" | "raw";
    if (!["indexed", "class", "raw"].includes(view)) throw errValidation({ view: "Unknown view." });
    let classFilter: string | null = null;
    if (query.class !== undefined && query.class !== "") {
      const classes = Object.values(event.heat_classes).flat();
      if (!classes.includes(query.class)) throw errValidation({ class: "This event does not run that class." });
      classFilter = query.class;
    }
    const now = new Date();
    let entries = await computeStandings(db, event);
    if (classFilter) entries = entries.filter((e) => e.classCode === classFilter);
    const ordered = orderRows(view, entries, positionsMap(entries));
    reply.send({
      eventId: event.id,
      status: reportedStatus(event.status, event.registration_cutoff, now),
      runningHeat: event.running_heat,
      view,
      updatedAt: now.toISOString(),
      rows: ordered.map(rowObject),
    });
  });

  // --- Protests ---
  app.post("/api/events/:id/protests", async (request, reply) => {
    const user = await requireUser(request);
    if (user.isOperator || !user.clubId) throw errNotFound();
    const event = await getEvent(db, (request.params as { id: string }).id, user.clubId);
    if (!event) throw errNotFound();
    const mine = await db.query(
      `SELECT id FROM registrations WHERE event_id = $1 AND driver_id = $2`,
      [event.id, user.id],
    );
    if (!mine[0]) throw errConflict("not_registered", "You are not registered for this event.");
    if (!protestWindowOpen(event.protest_window_closes_at, new Date())) {
      throw errConflict("protest_window_closed", "The protest window has closed.");
    }
    const schema = z.object({
      registrationId: z.string().min(1),
      text: z.string().trim().min(10).max(1000),
    });
    const parsed = safeParse(schema, request.body);
    if (!parsed.ok) throw errValidation(parsed.fields, "Fix these fields.");
    const subjectRows = await db.query(
      `SELECT id FROM registrations WHERE id = $1 AND event_id = $2`,
      [parsed.value.registrationId, event.id],
    );
    if (!subjectRows[0]) throw errValidation({ registrationId: "That car is not in this event." });
    const id = newId("pro");
    await db.query(
      `INSERT INTO protests (id, event_id, filed_by, subject_registration_id, text) VALUES ($1,$2,$3,$4,$5)`,
      [id, event.id, user.id, parsed.value.registrationId, parsed.value.text],
    );
    reply.status(201).send({ protest: await protestById(db, id) });
  });

  app.get("/api/events/:id/protests", async (request, reply) => {
    const user = await requireUser(request);
    if (user.isOperator || !user.clubId) throw errNotFound();
    const event = await getEvent(db, (request.params as { id: string }).id, user.clubId);
    if (!event) throw errNotFound();
    const rows = await db.query(`SELECT id FROM protests WHERE event_id = $1 ORDER BY filed_at DESC`, [event.id]);
    reply.send({ protests: await Promise.all(rows.map((r) => protestById(db, r.id as string))) });
  });

  app.post("/api/protests/:id/decision", async (request, reply) => {
    const user = await requireUser(request);
    requireRole(user, ["chair"]);
    const rows = await db.query(
      `SELECT p.id, e.status AS event_status, e.registration_cutoff, e.club_id
       FROM protests p JOIN events e ON e.id = p.event_id WHERE p.id = $1`,
      [(request.params as { id: string }).id],
    );
    const row = rows[0];
    if (!row || row.club_id !== user.clubId) throw errNotFound();
    const now = new Date();
    const status = reportedStatus(row.event_status as EventRow["status"], new Date(row.registration_cutoff as string), now);
    if (!CORRECTION_STATUSES.includes(status as never)) {
      throw errConflict("results_locked", "Results are final. Times can no longer change.");
    }
    if ((await protestById(db, row.id as string)).status !== "pending") {
      throw errConflict("protest_decided", "That protest has already been decided.");
    }
    const schema = z.object({
      decision: z.enum(["upheld", "denied"]),
      note: z.string().trim().min(5).max(1000),
    });
    const parsed = safeParse(schema, request.body);
    if (!parsed.ok) throw errValidation(parsed.fields, "Fix these fields.");
    await db.query(
      `UPDATE protests SET status=$1, decision_note=$2, decided_by=$3, decided_at=now() WHERE id=$4`,
      [parsed.value.decision, parsed.value.note, user.id, row.id],
    );
    reply.send({ protest: await protestById(db, row.id as string) });
  });

  // --- Publication ---
  app.get("/api/events/:id/publication", async (request, reply) => {
    const user = await requireUser(request);
    requireRole(user, ["chair"]);
    const event = await getEvent(db, (request.params as { id: string }).id, user.clubId);
    if (!event) throw errNotFound();
    const renderer = await services.renderer.status();
    const drivers = await db.query(
      `SELECT id FROM registrations WHERE event_id = $1 AND checked_in_at IS NOT NULL`,
      [event.id],
    );
    reply.send({
      status: event.status,
      renderer,
      publishedAt: event.published_at ? event.published_at.toISOString() : null,
      pdfKey: event.status === "published" ? await resultsKey(db, event) : null,
      checksum: event.results_checksum,
      emailsAccepted: event.status === "published" ? drivers.length : 0,
      emailsTotal: drivers.length,
    });
  });

  app.post("/api/events/:id/publish", async (request, reply) => {
    const user = await requireUser(request);
    requireRole(user, ["chair"]);
    const event = await getEvent(db, (request.params as { id: string }).id, user.clubId);
    if (!event) throw errNotFound();
    if (event.status === "published") throw errConflict("already_published", "Results are already published.");
    if (event.status !== "final") throw errConflict("not_final", "Results must be final before publishing.");

    const clubRows = await db.query(`SELECT slug, name FROM clubs WHERE id = $1`, [event.club_id]);
    const club = { slug: clubRows[0].slug as string, name: clubRows[0].name as string };
    const key = `clubs/${club.slug}/events/${event.id}/results/final.pdf`;

    // Step 1-2: render, store, read back and checksum. A retry reuses the stored object.
    let checksum = event.results_checksum;
    const storedAlready = checksum ? await services.storage.get(key) : null;
    if (!storedAlready || storedAlready.checksum !== checksum) {
      let pdf: Buffer;
      try {
        pdf = await renderResultsPdf(services.renderer, db, event, club.name);
      } catch {
        await recordFailure(db, event.club_id, event.id, "renderer");
        throw errDependency("renderer_unavailable", "Results PDF renderer is offline. Publishing is paused and drivers have not been emailed.");
      }
      try {
        checksum = await services.storage.putOnce(key, pdf, "application/pdf");
      } catch {
        await recordFailure(db, event.club_id, event.id, "storage");
        throw errDependency("storage_unavailable", "Results storage is offline. Nothing was published and drivers have not been emailed.");
      }
      const readBack = await services.storage.get(key);
      if (!readBack || readBack.checksum !== checksum) {
        await recordFailure(db, event.club_id, event.id, "storage");
        throw errDependency("storage_unavailable", "Results storage is offline. Nothing was published and drivers have not been emailed.");
      }
    }

    // Step 3: every checked-in driver's results email must be accepted.
    const drivers = await db.query(
      `SELECT r.id, u.email AS driver_email FROM registrations r JOIN users u ON u.id = r.driver_id
       WHERE r.event_id = $1 AND r.checked_in_at IS NOT NULL`,
      [event.id],
    );
    const entries = await loadEntries(db, event);
    for (const driver of drivers) {
      const entry = entries.find((e) => e.registrationId === driver.id);
      const position = entry && entry.position !== null ? `P${entry.position}` : "no time";
      const ok = await services.mailer.send({
        to: driver.driver_email as string,
        subject: `Final results: ${event.name}`,
        body: resultsEmailBody(services.config.appPublicUrl, event.id, position),
      });
      if (!ok) {
        await recordFailure(db, event.club_id, event.id, "mail");
        throw errDependency("mail_unavailable", "The mail server did not accept the results emails. Results are not published yet.");
      }
    }

    // Step 4: only now does the event become published.
    await db.query(
      `UPDATE events SET status='published', published_at=now(), results_checksum=$1, updated_at=now() WHERE id=$2`,
      [checksum, event.id],
    );
    const updated = await getEvent(db, event.id, user.clubId);
    reply.send({
      event: updated,
      publication: {
        status: "published",
        renderer: "ok",
        publishedAt: updated?.published_at?.toISOString() ?? null,
        pdfKey: key,
        checksum,
        emailsAccepted: drivers.length,
        emailsTotal: drivers.length,
      },
    });
  });

  app.get("/api/events/:id/results.pdf", async (request, reply) => {
    const user = await requireUser(request);
    if (user.isOperator || !user.clubId) throw errNotFound();
    const event = await getEvent(db, (request.params as { id: string }).id, user.clubId);
    if (!event || event.status !== "published" || !event.results_checksum) throw errNotFound();
    const object = await services.storage.get(await resultsKey(db, event));
    if (!object) throw errNotFound();
    reply.header("content-type", "application/pdf");
    reply.send(object.bytes);
  });
}

function rowObject(r: StandingsEntry) {
  return {
    registrationId: r.registrationId,
    carNumber: r.carNumber,
    classCode: r.classCode,
    driverName: r.driverName,
    carDescription: r.carDescription,
    position: r.position,
    classPosition: r.classPosition,
    rawPosition: r.rawPosition,
    bestAdjusted: r.bestAdjusted,
    bestIndexed: r.bestIndexed,
    lastChange: r.lastChange,
    runs: r.runs,
  };
}

function positionsMap(entries: StandingsEntry[]) {
  return new Map(entries.map((e) => [e.registrationId, {
    bestAdjusted: e.bestAdjusted, bestIndexed: e.bestIndexed,
    position: e.position, classPosition: e.classPosition, rawPosition: e.rawPosition,
  }]));
}

async function protestById(db: Db, id: string): Promise<Record<string, unknown>> {
  const rows = await db.query(
    `SELECT p.*, u.name AS filed_by_name, r.car_number AS subject_car, r.class_code AS subject_class,
            su.name AS subject_name, su.id AS subject_driver, du.name AS decided_by_name
     FROM protests p
     JOIN users u ON u.id = p.filed_by
     JOIN registrations r ON r.id = p.subject_registration_id
     JOIN users su ON su.id = r.driver_id
     LEFT JOIN users du ON du.id = p.decided_by
     WHERE p.id = $1`,
    [id],
  );
  const r = rows[0];
  return {
    id: r.id as string,
    filedBy: { id: r.filed_by as string, name: r.filed_by_name as string },
    subject: {
      registrationId: r.subject_registration_id as string,
      carNumber: r.subject_car as number,
      classCode: r.subject_class as string,
      driverName: r.subject_name as string,
    },
    text: r.text as string,
    filedAt: new Date(r.filed_at as string).toISOString(),
    status: r.status as string,
    decisionNote: (r.decision_note as string | null) ?? null,
    decidedBy: r.decided_by ? { id: r.decided_by as string, name: r.decided_by_name as string } : null,
    decidedAt: r.decided_at ? new Date(r.decided_at as string).toISOString() : null,
  };
}

async function resultsKey(db: Db, event: EventRow): Promise<string> {
  const rows = await db.query(`SELECT slug FROM clubs WHERE id = $1`, [event.club_id]);
  return `clubs/${rows[0].slug}/events/${event.id}/results/final.pdf`;
}

async function recordFailure(db: Db, clubId: string, eventId: string, service: "renderer" | "storage" | "mail"): Promise<void> {
  await db.query(
    `INSERT INTO delivery_failures (id, club_id, event_id, service) VALUES ($1,$2,$3,$4)`,
    [newId("fail"), clubId, eventId, service],
  );
}

/** The final results PDF: Raw, Class and Indexed sections, each on its own page. */
async function renderResultsPdf(renderer: Renderer, db: Db, event: EventRow, clubName: string): Promise<Buffer> {
  const entries = await loadEntries(db, event);
  const rawRows = orderRows("raw", entries, positionsMap(entries));
  const classRows = orderRows("class", entries, positionsMap(entries));
  const indexedRows = orderRows("indexed", entries, positionsMap(entries));
  const line = (view: "Raw" | "Class" | "Indexed") => (e: StandingsEntry): ResultsLine => ({
    position: viewPosition(e, view),
    carNumber: e.carNumber,
    classCode: e.classCode,
    driverName: e.driverName,
    time: view === "Indexed" ? (e.bestIndexed ?? "No time") : (e.bestAdjusted ?? "No time"),
    extra: view === "Indexed" ? (event.factors[e.classCode] ?? "") : "",
  });
  const html = resultsHtml(clubName, event, [
    { title: "Raw", rows: rawRows.map(line("Raw")) },
    { title: "Class", rows: classRows.map(line("Class")) },
    { title: "Indexed", rows: indexedRows.map(line("Indexed")) },
  ]);
  return renderer.renderPdf(html);
}

function viewPosition(e: StandingsEntry, view: "Raw" | "Class" | "Indexed"): string {
  if (view === "Raw") return e.rawPosition !== null ? `P${e.rawPosition}` : "No time";
  if (view === "Class") return e.classPosition !== null ? `P${e.classPosition}` : "No time";
  return e.position !== null ? `P${e.position}` : "No time";
}
