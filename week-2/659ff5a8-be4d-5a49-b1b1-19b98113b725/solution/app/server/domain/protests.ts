import { z } from "zod";
import type { Protest } from "../../shared/api.js";
import { type ClubAuth, requireRole } from "../auth.js";
import { type Db, one, pool, returning, rows, transaction } from "../db.js";
import { ApiError, validationError } from "../errors.js";
import { parse, wholeNumber } from "../validate.js";
import { findEvent, protestWindowOpen, reportedStatus } from "./events.js";

interface ProtestRow {
  id: number;
  filed_by: number;
  filer_name: string;
  registration_id: number;
  car_number: number;
  class_code: string;
  subject_name: string;
  text: string;
  filed_at: Date;
  status: Protest["status"];
  decision_note: string | null;
  decider_name: string | null;
  decided_at: Date | null;
}

const SELECT = `
  select p.id, p.filed_by, f.name as filer_name, r.id as registration_id, r.car_number, r.class_code,
         s.name as subject_name, p.text, p.filed_at, p.status, p.decision_note, d.name as decider_name, p.decided_at
    from protests p
    join users f on f.id = p.filed_by
    join registrations r on r.id = p.subject_registration_id
    join users s on s.id = r.user_id
    left join users d on d.id = p.decided_by`;

function view(row: ProtestRow): Protest {
  return {
    id: row.id,
    filedBy: { id: row.filed_by, name: row.filer_name },
    subject: {
      registrationId: row.registration_id,
      carNumber: row.car_number,
      classCode: row.class_code,
      driverName: row.subject_name,
    },
    text: row.text,
    filedAt: row.filed_at.toISOString(),
    status: row.status,
    decisionNote: row.decision_note,
    decidedBy: row.decider_name,
    decidedAt: row.decided_at?.toISOString() ?? null,
  };
}

export async function listProtests(auth: ClubAuth, eventId: number): Promise<Protest[]> {
  await findEvent(pool, auth.club.id, eventId);
  return (await rows<ProtestRow>(pool, `${SELECT} where p.event_id = $1 order by p.id`, [eventId])).map(view);
}

const fileSchema = z.object({
  registrationId: wholeNumber("Car protested", 1, 2_147_483_647),
  text: z
    .string({ error: "Describe the protest in at least 10 characters." })
    .trim()
    .min(10, "Describe the protest in at least 10 characters.")
    .max(1000, "Describe the protest in at most 1000 characters."),
});

export async function fileProtest(auth: ClubAuth, eventId: number, body: unknown): Promise<Protest> {
  const event = await findEvent(pool, auth.club.id, eventId);
  if (!(await one(pool, "select 1 from registrations where event_id = $1 and user_id = $2", [eventId, auth.userId]))) {
    throw new ApiError("not_registered");
  }
  if (!protestWindowOpen(event, new Date())) throw new ApiError("protest_window_closed");
  const input = parse(fileSchema, body);
  if (!(await one(pool, "select 1 from registrations where id = $1 and event_id = $2", [input.registrationId, eventId]))) {
    throw validationError({ registrationId: "Choose a car in this event." });
  }
  const created = await returning<{ id: number }>(
    pool,
    "insert into protests (event_id, filed_by, subject_registration_id, text) values ($1, $2, $3, $4) returning id",
    [eventId, auth.userId, input.registrationId, input.text],
  );
  return protestById(pool, created.id);
}

async function protestById(db: Db, id: number): Promise<Protest> {
  return view(await returning<ProtestRow>(db, `${SELECT} where p.id = $1`, [id]));
}

const decisionSchema = z.object({
  decision: z.enum(["upheld", "denied"], { error: "Choose upheld or denied." }),
  note: z
    .string({ error: "Give a note of at least 5 characters." })
    .trim()
    .min(5, "Give a note of at least 5 characters.")
    .max(1000, "Give a note of at most 1000 characters."),
});

export async function decideProtest(auth: ClubAuth, protestId: number, body: unknown): Promise<Protest> {
  const found = await one<{ event_id: number }>(
    pool,
    `select p.event_id from protests p join events e on e.id = p.event_id where p.id = $1 and e.club_id = $2`,
    [protestId, auth.club.id],
  );
  if (!found) throw new ApiError("not_found");
  requireRole(auth, "chair");
  return transaction(async (db) => {
    const event = await findEvent(db, auth.club.id, found.event_id, true);
    if (reportedStatus(event, new Date()) !== "provisional") throw new ApiError("results_locked");
    const current = await returning<{ status: Protest["status"] }>(db, "select status from protests where id = $1 for update", [protestId]);
    if (current.status !== "pending") throw new ApiError("protest_decided");
    const input = parse(decisionSchema, body);
    await db.query(
      "update protests set status = $2, decision_note = $3, decided_by = $4, decided_at = now() where id = $1",
      [protestId, input.decision, input.note, auth.userId],
    );
    return protestById(db, protestId);
  });
}
