import { z } from "zod";
import type { RegistrationView } from "../../shared/api.js";
import { checkInOpen, withdrawalOpen } from "../../shared/lifecycle.js";
import { localStamp } from "../../shared/time.js";
import { type ClubAuth, can } from "../auth.js";
import { type Db, isUniqueViolation, one, pool, returning, rows, transaction } from "../db.js";
import { ApiError, validationError } from "../errors.js";
import { deliver, queueDelivery, recordFailureFor } from "../services/outbox.js";
import { renderPdf } from "../services/pdf.js";
import { type WaiverDetails, waiverHtml } from "../services/pdfHtml.js";
import { readObject, storeOnce } from "../services/storage.js";
import { parse, text, wholeNumber } from "../validate.js";
import { findEvent, reportedStatus } from "./events.js";

interface RegistrationRow {
  id: number;
  event_id: number;
  user_id: number;
  driver_name: string;
  driver_email: string;
  class_code: string;
  car_number: number;
  car_description: string;
  run_heat: number;
  checked_in_at: Date | null;
  /** Stored together at check-in, so both are present or neither is. */
  waiver: { key: string; checksum: string } | null;
  station: { id: number; name: string; heat: number } | null;
  confirmation: string | null;
}

const SELECT = `
  select r.id, r.event_id, r.user_id, u.name as driver_name, u.email as driver_email, r.class_code, r.car_number,
         r.car_description, r.run_heat, r.checked_in_at,
         case when r.waiver_key is null then null
              else jsonb_build_object('key', r.waiver_key, 'checksum', r.waiver_checksum) end as waiver,
         case when s.id is null then null
              else jsonb_build_object('id', s.id, 'name', s.name, 'heat', s.heat) end as station,
         d.status as confirmation
    from registrations r
    join users u on u.id = r.user_id
    left join stations s on s.worker_registration_id = r.id
    left join email_deliveries d on d.registration_id = r.id and d.kind = 'registration'`;

function view(row: RegistrationRow): RegistrationView {
  return {
    id: row.id,
    eventId: row.event_id,
    driver: { id: row.user_id, name: row.driver_name },
    classCode: row.class_code,
    carNumber: row.car_number,
    carDescription: row.car_description,
    runHeat: row.run_heat,
    checkedIn: row.checked_in_at !== null,
    checkedInAt: row.checked_in_at?.toISOString() ?? null,
    waiver: row.waiver,
    station: row.station,
    confirmationEmail: row.confirmation === "pending" ? "pending" : "sent",
  };
}

export async function listRegistrations(db: Db, eventId: number): Promise<RegistrationView[]> {
  const found = await rows<RegistrationRow>(db, `${SELECT} where r.event_id = $1 order by r.class_code, r.car_number`, [eventId]);
  return found.map(view);
}

export async function registrationView(db: Db, registrationId: number): Promise<RegistrationView> {
  return view(await returning<RegistrationRow>(db, `${SELECT} where r.id = $1`, [registrationId]));
}

/** A registration inside the signed-in user's club, or 404. */
export async function findRegistration(db: Db, auth: ClubAuth, id: number): Promise<RegistrationRow> {
  const row = await one<RegistrationRow>(
    db,
    `${SELECT} join events e on e.id = r.event_id where r.id = $1 and e.club_id = $2`,
    [id, auth.club.id],
  );
  if (!row) throw new ApiError("not_found");
  return row;
}

/** The driver themself or the chair. */
function requireOwnerOrChair(auth: ClubAuth, row: RegistrationRow): void {
  if (row.user_id !== auth.userId && !can(auth, "chair")) throw new ApiError("forbidden");
}

const registerSchema = z.object({
  classCode: z.string({ error: "Choose a class." }),
  carNumber: wholeNumber("Car number", 1, 999),
  carDescription: text("Car description", 80),
});

export async function register(auth: ClubAuth, eventId: number, body: unknown): Promise<RegistrationView> {
  const created = await transaction(async (db) => {
    const event = await findEvent(db, auth.club.id, eventId);
    if (reportedStatus(event, new Date()) !== "registration_open") throw new ApiError("registration_closed");
    const mine = await one(db, "select 1 from registrations where event_id = $1 and user_id = $2", [eventId, auth.userId]);
    if (mine) throw new ApiError("already_registered");
    const input = parse(registerSchema, body);
    const heat = await one<{ heat: number }>(
      db,
      "select heat from event_classes where event_id = $1 and class_code = $2",
      [eventId, input.classCode],
    );
    if (!heat) throw validationError({ classCode: "Choose a class this event runs." });
    const taken = new ApiError("car_number_taken", `Car ${input.carNumber} is already taken in ${input.classCode}.`);
    if (await one(db, "select 1 from registrations where event_id = $1 and class_code = $2 and car_number = $3", [eventId, input.classCode, input.carNumber])) {
      throw taken;
    }
    let id: number;
    try {
      id = (
        await returning<{ id: number }>(
          db,
          `insert into registrations (event_id, user_id, class_code, car_number, car_description, run_heat)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [eventId, auth.userId, input.classCode, input.carNumber, input.carDescription, heat.heat],
        )
      ).id;
    } catch (error) {
      if (isUniqueViolation(error, "registrations_car_key")) throw taken;
      if (isUniqueViolation(error, "registrations_driver_key")) throw new ApiError("already_registered");
      throw error;
    }
    await db.query("insert into runs (registration_id, run_number) select $1, n from generate_series(1, $2::int) n", [
      id,
      event.runs_per_driver,
    ]);
    const deliveryId = await queueDelivery(db, {
      kind: "registration",
      registrationId: id,
      recipient: auth.email,
      subject: `Registered for ${event.name}: car ${input.carNumber} ${input.classCode}`,
      body: [
        `Hello ${auth.name},`,
        "",
        `You are registered for ${event.name} on ${event.date} at ${event.venue}.`,
        `Car ${input.carNumber} ${input.classCode}`,
        `Run heat ${heat.heat}`,
      ].join("\n"),
    });
    return { id, deliveryId };
  });
  await deliver(created.deliveryId);
  return registrationView(pool, created.id);
}

export async function withdraw(auth: ClubAuth, registrationId: number): Promise<void> {
  await transaction(async (db) => {
    const row = await findRegistration(db, auth, registrationId);
    requireOwnerOrChair(auth, row);
    const event = await findEvent(db, auth.club.id, row.event_id);
    if (!withdrawalOpen(reportedStatus(event, new Date()))) throw new ApiError("withdrawal_closed");
    await db.query("delete from registrations where id = $1", [registrationId]);
  });
}

export async function waiverPdf(auth: ClubAuth, registrationId: number): Promise<Buffer> {
  const row = await findRegistration(pool, auth, registrationId);
  requireOwnerOrChair(auth, row);
  if (row.waiver === null) throw new ApiError("not_found");
  return readObject(row.waiver.key);
}

const signatureSchema = z.object({ signature: z.string({ error: "Type your name exactly as registered." }) });

export async function checkIn(auth: ClubAuth, registrationId: number, body: unknown): Promise<RegistrationView> {
  const row = await findRegistration(pool, auth, registrationId);
  requireOwnerOrChair(auth, row);
  const event = await findEvent(pool, auth.club.id, row.event_id);
  if (!checkInOpen(reportedStatus(event, new Date()))) throw new ApiError("check_in_closed");
  if (row.checked_in_at !== null) throw new ApiError("already_checked_in");
  const { signature } = parse(signatureSchema, body);
  const typed = signature.trim();
  if (typed.toLowerCase() !== row.driver_name.trim().toLowerCase()) {
    throw validationError({ signature: "Type your name exactly as registered." });
  }
  const details: WaiverDetails = {
    clubName: auth.club.name,
    eventName: event.name,
    eventDate: event.date,
    driverName: row.driver_name,
    carNumber: row.car_number,
    classCode: row.class_code,
    signature: typed,
    signedAt: `${localStamp(new Date(), "UTC")} UTC`,
  };
  const key = `clubs/${auth.club.slug}/events/${event.id}/waivers/${registrationId}.pdf`;
  try {
    const checksum = await storeOnce(key, await renderPdf(waiverHtml(details)));
    const marked = await pool.query(
      `update registrations set checked_in_at = now(), waiver_key = $2, waiver_checksum = $3
        where id = $1 and checked_in_at is null`,
      [registrationId, key, checksum],
    );
    if (marked.rowCount === 0) throw new ApiError("already_checked_in");
  } catch (error) {
    await recordFailureFor(error, auth.club.id, event.id);
    throw error;
  }
  return registrationView(pool, registrationId);
}
