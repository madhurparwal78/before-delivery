// Requesting, listing, changing, releasing and cancelling assignments.
import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { requireRole } from "./auth.js";
import { rateInForce } from "./charges.js";
import { type Db, pool, transaction } from "./db.js";
import { ApiError, type FieldErrors, type Reply, type SignedInContext, route } from "./http.js";
import { cancelledEmail, changedEmail, enqueue, offerEmail } from "./mail.js";
import { type AssignmentRecord, interpreterLanguages, loadAssignments, reloadAssignment } from "./records.js";
import { businessMinutes, cancellationFee, isLateNotice, seatCount } from "./rules.js";
import { MESSAGES, asObject, textField, validDuration, validStart } from "./validation.js";
import { present, viewFor, visibleAssignment } from "./views.js";

const SETTINGS = new Set(["hospital", "clinic", "school"]);
const CHANGEABLE = new Set(["draft", "released", "partially_covered", "covered"]);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function idempotencyKey(ctx: SignedInContext): string {
  const key = ctx.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 1 || key.length > 100 || !/^[\x20-\x7e]+$/.test(key)) {
    throw new ApiError("idempotency_key_required");
  }
  return key;
}

async function seededLanguages(db: Db): Promise<Set<string>> {
  const rows = await db.query<{ code: string }>("SELECT code FROM languages");
  return new Set(rows.rows.map((r) => r.code));
}

interface NewAssignment {
  language: string;
  setting: string;
  start: DateTime;
  duration: number;
  streetAddress: string;
  city: string;
  patientInitials: string;
  medicalNotes: string;
}

async function validateNew(db: Db, body: unknown): Promise<NewAssignment> {
  const input = asObject(body) ?? {};
  const errors: FieldErrors = {};
  const language = input.language;
  if (typeof language !== "string" || !(await seededLanguages(db)).has(language)) errors.language = MESSAGES.language;
  const setting = input.setting;
  if (typeof setting !== "string" || !SETTINGS.has(setting)) errors.setting = MESSAGES.setting;
  const duration = validDuration(input.duration_minutes) ? input.duration_minutes : null;
  if (duration === null) errors.duration_minutes = MESSAGES.duration;
  const start = validStart(errors, input.start_at, duration);
  const streetAddress = textField(errors, input, "street_address", 200, MESSAGES.street, { required: true });
  const city = textField(errors, input, "city", 80, MESSAGES.city, { required: true });
  const initials = input.patient_initials;
  if (typeof initials !== "string" || !/^[A-Z]{2,3}$/.test(initials)) errors.patient_initials = MESSAGES.initials;
  const medicalNotes = textField(errors, input, "medical_notes", 1000, MESSAGES.notes, { required: false });
  if (Object.keys(errors).length > 0 || !start || duration === null) throw new ApiError("validation", errors);
  return {
    language: language as string,
    setting: setting as string,
    start,
    duration,
    streetAddress,
    city,
    patientInitials: initials as string,
    medicalNotes,
  };
}

async function insertSeats(db: Db, assignmentId: number, count: number): Promise<void> {
  for (let seat = 1; seat <= count; seat += 1) {
    await db.query("INSERT INTO seats (assignment_id, seat, status) VALUES ($1, $2, 'open')", [assignmentId, seat]);
  }
}


/** Each active interpreter qualified in the language gets one offer email; returns how many. */
async function sendOffers(db: Db, record: AssignmentRecord): Promise<number> {
  const interpreters = await db.query<{ email: string }>(
    `SELECT p.email FROM people p JOIN interpreter_languages il ON il.person_id = p.id
      WHERE p.role = 'interpreter' AND p.active AND il.language_code = $1 ORDER BY p.email`,
    [record.languageCode],
  );
  for (const interpreter of interpreters.rows) await enqueue(db, interpreter.email, offerEmail(record));
  return interpreters.rows.length;
}

async function createAssignment(ctx: SignedInContext): Promise<Reply> {
  const person = requireRole(ctx, "scheduler");
  const key = idempotencyKey(ctx);
  const fingerprint = createHash("sha256").update(canonicalJson(ctx.body)).digest("hex");
  return transaction(async (db) => {
    const claimed = await db.query(
      `INSERT INTO idempotency_keys (person_id, key, fingerprint) VALUES ($1, $2, $3)
       ON CONFLICT (person_id, key) DO NOTHING`,
      [person.id, key, fingerprint],
    );
    if (claimed.rowCount === 0) {
      const stored = await db.query<{ fingerprint: string; response: unknown }>(
        "SELECT fingerprint, response FROM idempotency_keys WHERE person_id = $1 AND key = $2",
        [person.id, key],
      );
      const original = stored.rows[0];
      if (!original || original.fingerprint !== fingerprint) throw new ApiError("idempotency_conflict");
      return { status: 201, json: original.response, headers: { "Idempotent-Replay": "true" } };
    }
    const request = await validateNew(db, ctx.body);
    const counter = await db.query<{ value: number }>(
      "UPDATE counters SET value = value + 1 WHERE name = 'assignment_number' RETURNING value",
    );
    const inserted = await db.query<{ id: number }>(
      `INSERT INTO assignments (number, org_code, scheduler_id, language_code, setting, start_at, duration_minutes,
                                street_address, city, patient_initials, medical_notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft') RETURNING id`,
      [
        `A-${counter.rows[0]!.value}`,
        person.orgCode,
        person.id,
        request.language,
        request.setting,
        request.start.toJSDate(),
        request.duration,
        request.streetAddress,
        request.city,
        request.patientInitials,
        request.medicalNotes,
      ],
    );
    const id = inserted.rows[0]!.id;
    await insertSeats(db, id, seatCount(request.language, request.duration));
    const json = await present(await reloadAssignment(db, id), "organisation", db);
    await db.query("UPDATE idempotency_keys SET response = $3 WHERE person_id = $1 AND key = $2", [
      person.id,
      key,
      JSON.stringify(json),
    ]);
    return { status: 201, json };
  });
}

async function listAssignments(ctx: SignedInContext): Promise<Reply> {
  const person = requireRole(ctx, "scheduler", "org_admin", "dispatcher", "billing_lead");
  const q = (ctx.query.get("q") ?? "").trim().toLowerCase();
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const records = await loadAssignments(q ? "(lower(a.number) = $1 OR lower(a.city) LIKE $2)" : "true", q ? [q, pattern] : []);
  const visible = records.flatMap((record) => {
    const kind = viewFor(person, record, []);
    return kind ? [present(record, kind)] : [];
  });
  return { status: 200, json: { assignments: await Promise.all(visible) } };
}

async function getAssignment(ctx: SignedInContext): Promise<Reply> {
  const { record, kind } = await visibleAssignment(ctx.session.person, ctx.params.number ?? "");
  return { status: 200, json: await present(record, kind) };
}

/** True when the body asks for a different start or duration than the assignment has now. */
function asksTimeChange(record: AssignmentRecord, body: Record<string, unknown>): boolean {
  if ("duration_minutes" in body && body.duration_minutes !== record.durationMinutes) return true;
  if (!("start_at" in body)) return false;
  const asked = typeof body.start_at === "string" ? DateTime.fromISO(body.start_at, { setZone: true }) : null;
  return !asked?.isValid || asked.toMillis() !== record.startAt.getTime();
}

async function changeAssignment(ctx: SignedInContext): Promise<Reply> {
  const person = ctx.session.person;
  return transaction(async (db) => {
    const { record } = await visibleAssignment(person, ctx.params.number ?? "", db, true);
    requireRole(ctx, "scheduler");
    if (!CHANGEABLE.has(record.status)) throw new ApiError("invalid_transition");
    const body = asObject(ctx.body) ?? {};
    const timeChange = asksTimeChange(record, body);
    if (timeChange && isLateNotice(businessMinutes(DateTime.now(), DateTime.fromJSDate(record.startAt)))) {
      throw new ApiError("late_change");
    }
    const errors: FieldErrors = {};
    const duration = "duration_minutes" in body ? body.duration_minutes : record.durationMinutes;
    if (!validDuration(duration)) errors.duration_minutes = MESSAGES.duration;
    const start = timeChange
      ? validStart(errors, body.start_at ?? DateTime.fromJSDate(record.startAt).toISO(), validDuration(duration) ? duration : null)
      : DateTime.fromJSDate(record.startAt);
    const streetAddress =
      "street_address" in body ? textField(errors, body, "street_address", 200, MESSAGES.street, { required: true }) : record.streetAddress;
    const city = "city" in body ? textField(errors, body, "city", 80, MESSAGES.city, { required: true }) : record.city;
    const medicalNotes =
      "medical_notes" in body ? textField(errors, body, "medical_notes", 1000, MESSAGES.notes, { required: false }) : record.medicalNotes;
    if (Object.keys(errors).length > 0 || !start || !validDuration(duration)) throw new ApiError("validation", errors);
    await db.query("UPDATE assignments SET street_address = $2, city = $3, medical_notes = $4 WHERE id = $1", [
      record.id,
      streetAddress,
      city,
      medicalNotes,
    ]);
    if (timeChange) {
      const freed = record.seats.filter((s) => s.status === "held");
      await db.query(
        "UPDATE holds SET outcome = 'freed_by_change', ended_at = now() WHERE assignment_id = $1 AND outcome = 'held'",
        [record.id],
      );
      await db.query("DELETE FROM seats WHERE assignment_id = $1", [record.id]);
      await insertSeats(db, record.id, seatCount(record.languageCode, duration));
      await db.query(
        `UPDATE assignments SET start_at = $2, duration_minutes = $3,
                status = CASE WHEN status = 'draft' THEN 'draft' ELSE 'released' END
          WHERE id = $1`,
        [record.id, start.toJSDate(), duration],
      );
      const changed = await reloadAssignment(db, record.id);
      const holders = await db.query<{ email: string }>("SELECT email FROM people WHERE id = ANY($1)", [
        freed.map((s) => s.holderId),
      ]);
      const notice = changedEmail(changed);
      const scheduler = await db.query<{ email: string }>("SELECT email FROM people WHERE id = $1", [changed.schedulerId]);
      for (const row of [...scheduler.rows, ...holders.rows]) await enqueue(db, row.email, notice);
      if (changed.status === "released") await sendOffers(db, changed);
    }
    return { status: 200, json: await present(await reloadAssignment(db, record.id), "organisation", db) };
  });
}

async function releaseAssignment(ctx: SignedInContext): Promise<Reply> {
  return transaction(async (db) => {
    const { record } = await visibleAssignment(ctx.session.person, ctx.params.number ?? "", db, true);
    requireRole(ctx, "dispatcher");
    if (record.status !== "draft") throw new ApiError("invalid_transition");
    await db.query("UPDATE assignments SET status = 'released' WHERE id = $1", [record.id]);
    const released = await reloadAssignment(db, record.id);
    const offersSent = await sendOffers(db, released);
    return { status: 200, json: { assignment: await present(released, "staff", db), offers_sent: offersSent } };
  });
}

/** The fee decision for cancelling `record` at `now`. */
async function quoteFor(record: AssignmentRecord, now: DateTime, db: Db | typeof pool) {
  const notice = businessMinutes(now, DateTime.fromJSDate(record.startAt));
  const rate = await rateInForce(record.orgCode, record.languageCode, record.startAt, db);
  return { notice, rate, ...cancellationFee(record.status, notice, record.seats.length, rate.hourly_rate_cents) };
}

async function cancellationQuote(ctx: SignedInContext): Promise<Reply> {
  const { record } = await visibleAssignment(ctx.session.person, ctx.params.number ?? "");
  requireRole(ctx, "scheduler");
  if (!CHANGEABLE.has(record.status)) throw new ApiError("invalid_transition");
  const quote = await quoteFor(record, DateTime.now(), pool);
  return {
    status: 200,
    json: { fee_applies: quote.feeApplies, business_minutes_notice: quote.notice, fee_cents: quote.feeCents },
  };
}

async function cancelAssignment(ctx: SignedInContext): Promise<Reply> {
  const person = ctx.session.person;
  return transaction(async (db) => {
    const { record } = await visibleAssignment(person, ctx.params.number ?? "", db, true);
    requireRole(ctx, "scheduler");
    if (!CHANGEABLE.has(record.status)) throw new ApiError("invalid_transition");
    const now = DateTime.now();
    const quote = await quoteFor(record, now, db);
    await db.query(
      `INSERT INTO cancellations (assignment_id, cancelled_at, fee_applies, business_minutes_notice, fee_cents, seats,
                                  rate_effective_from, hourly_rate_cents, mileage_cents_per_mile)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        record.id,
        now.toJSDate(),
        quote.feeApplies,
        quote.notice,
        quote.feeCents,
        record.seats.length,
        quote.feeApplies ? quote.rate.effective_from : null,
        quote.feeApplies ? quote.rate.hourly_rate_cents : null,
        quote.feeApplies ? quote.rate.mileage_cents_per_mile : null,
      ],
    );
    await db.query(
      `UPDATE assignments SET status = 'cancelled',
              billing_status = CASE WHEN $2::boolean THEN 'ready' ELSE billing_status END
        WHERE id = $1`,
      [record.id, quote.feeApplies],
    );
    await db.query("INSERT INTO audit_log (actor_id, action, assignment_id, detail) VALUES ($1, 'cancellation', $2, $3)", [
      person.id,
      record.id,
      JSON.stringify({ fee_applies: quote.feeApplies, business_minutes_notice: quote.notice, fee_cents: quote.feeCents }),
    ]);
    const notice = cancelledEmail(record, quote.feeApplies, quote.feeCents);
    const recipients = await db.query<{ email: string }>(
      `SELECT email FROM people WHERE id = $1
       UNION ALL
       SELECT p.email FROM seats st JOIN people p ON p.id = st.holder_id WHERE st.assignment_id = $2 AND st.status = 'held'`,
      [record.schedulerId, record.id],
    );
    for (const row of recipients.rows) await enqueue(db, row.email, notice);
    return { status: 200, json: await present(await reloadAssignment(db, record.id), "organisation", db) };
  });
}

/** Offer views of open work in the interpreter's languages that they do not already hold. */
async function listOffers(ctx: SignedInContext): Promise<Reply> {
  const person = requireRole(ctx, "interpreter");
  const languages = await interpreterLanguages(person.id);
  const records = await loadAssignments(
    "a.status IN ('released','partially_covered') AND a.start_at > now()",
    [],
  );
  const offers = records.filter((r) => viewFor(person, r, languages) === "offer");
  return { status: 200, json: { offers: await Promise.all(offers.map((r) => present(r, "offer"))) } };
}

export function registerAssignmentRoutes(): void {
  route("POST", "/api/assignments", createAssignment);
  route("GET", "/api/assignments", listAssignments);
  route("GET", "/api/assignments/{number}", getAssignment);
  route("PATCH", "/api/assignments/{number}", changeAssignment);
  route("POST", "/api/assignments/{number}/release", releaseAssignment);
  route("GET", "/api/assignments/{number}/cancellation-quote", cancellationQuote);
  route("POST", "/api/assignments/{number}/cancel", cancelAssignment);
  route("GET", "/api/offers", listOffers);
}
