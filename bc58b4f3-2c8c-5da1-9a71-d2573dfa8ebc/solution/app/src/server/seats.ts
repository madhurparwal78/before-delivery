// Claiming, giving back and verifying seats, and the private links to stored verification forms.
import { randomBytes } from "node:crypto";
import { hashToken, requireRole } from "./auth.js";
import { type Db, pool, transaction } from "./db.js";
import { ApiError, type FieldErrors, type FilePart, type Reply, type SignedInContext, route } from "./http.js";
import { coveredEmail, enqueue, seatConfirmedEmail } from "./mail.js";
import { type AssignmentRecord, type SeatRecord, endOf, loadAssignments, reloadAssignment } from "./records.js";
import { s3Request } from "./storage.js";
import { isHolder, present, viewFor, visibleAssignment } from "./views.js";

const CLAIMABLE = new Set(["released", "partially_covered"]);
const LINK_SECONDS = 60;

function seatOf(record: AssignmentRecord, ctx: SignedInContext): SeatRecord {
  const seat = record.seats.find((s) => String(s.seat) === ctx.params.seat);
  if (!seat) throw new ApiError("not_found");
  return seat;
}


async function emailOf(db: Db, personId: string): Promise<string> {
  const row = await db.query<{ email: string }>("SELECT email FROM people WHERE id = $1", [personId]);
  return row.rows[0]?.email ?? "";
}

async function claimSeat(ctx: SignedInContext): Promise<Reply> {
  const person = ctx.session.person;
  return transaction(async (db) => {
    // One claim at a time per interpreter, then per assignment: the calendar and seat checks below see every
    // committed hold, so simultaneous claims leave exactly one holder and never an overlapping pair.
    await db.query("SELECT id FROM people WHERE id = $1 FOR UPDATE", [person.id]);
    const { record } = await visibleAssignment(person, ctx.params.number ?? "", db, true);
    requireRole(ctx, "interpreter");
    const seat = seatOf(record, ctx);
    if (!CLAIMABLE.has(record.status) || seat.status !== "open") throw new ApiError("seat_taken");
    if (isHolder(record, person.id)) throw new ApiError("already_holding");
    const overlapping = await db.query(
      `SELECT 1 FROM seats st JOIN assignments a ON a.id = st.assignment_id
        WHERE st.holder_id = $1 AND st.status IN ('held','served') AND a.status <> 'cancelled' AND a.id <> $2
          AND a.start_at < $4 AND a.start_at + make_interval(mins => a.duration_minutes) > $3
        LIMIT 1`,
      [person.id, record.id, record.startAt, endOf(record)],
    );
    if (overlapping.rowCount) throw new ApiError("calendar_conflict");
    await db.query("UPDATE seats SET status = 'held', holder_id = $3 WHERE assignment_id = $1 AND seat = $2", [
      record.id,
      seat.seat,
      person.id,
    ]);
    await db.query("INSERT INTO holds (assignment_id, seat, interpreter_id) VALUES ($1, $2, $3)", [
      record.id,
      seat.seat,
      person.id,
    ]);
    const nowCovered = record.seats.every((s) => s.seat === seat.seat || s.status !== "open");
    await db.query("UPDATE assignments SET status = $2 WHERE id = $1", [
      record.id,
      nowCovered ? "covered" : "partially_covered",
    ]);
    const claimed = await reloadAssignment(db, record.id);
    await enqueue(db, person.email, seatConfirmedEmail(claimed, seat.seat));
    if (nowCovered) await enqueue(db, await emailOf(db, claimed.schedulerId), coveredEmail(claimed));
    return { status: 200, json: await present(claimed, "holder", db) };
  });
}

async function giveBackSeat(ctx: SignedInContext): Promise<Reply> {
  const person = ctx.session.person;
  return transaction(async (db) => {
    const { record } = await visibleAssignment(person, ctx.params.number ?? "", db, true);
    requireRole(ctx, "interpreter");
    const seat = seatOf(record, ctx);
    if (seat.holderId !== person.id) throw new ApiError("forbidden");
    if (!["partially_covered", "covered"].includes(record.status) || seat.status !== "held") {
      throw new ApiError("invalid_transition");
    }
    await db.query("UPDATE seats SET status = 'open', holder_id = NULL WHERE assignment_id = $1 AND seat = $2", [
      record.id,
      seat.seat,
    ]);
    await db.query(
      `UPDATE holds SET outcome = 'released_back', ended_at = now()
        WHERE assignment_id = $1 AND seat = $2 AND interpreter_id = $3 AND outcome = 'held'`,
      [record.id, seat.seat, person.id],
    );
    const stillHeld = record.seats.some((s) => s.seat !== seat.seat && s.status === "held");
    await db.query("UPDATE assignments SET status = $2 WHERE id = $1", [
      record.id,
      stillHeld ? "partially_covered" : "released",
    ]);
    return { status: 200, json: await present(await reloadAssignment(db, record.id), "offer", db) };
  });
}

const FORM_TYPES: ReadonlyArray<{ type: string; extension: string; signature: Buffer }> = [
  { type: "application/pdf", extension: "pdf", signature: Buffer.from("%PDF-", "latin1") },
  { type: "image/jpeg", extension: "jpg", signature: Buffer.from([0xff, 0xd8, 0xff]) },
  { type: "image/png", extension: "png", signature: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
];

/** The stored type of an upload whose content matches its declared PDF, JPEG or PNG type; null otherwise. */
function formType(file: FilePart): (typeof FORM_TYPES)[number] | null {
  const declared = FORM_TYPES.find((t) => t.type === file.contentType);
  return declared && file.data.subarray(0, declared.signature.length).equals(declared.signature) ? declared : null;
}

function wholeNumber(value: string | undefined, min: number, max: number): number | null {
  if (value === undefined || !/^\d{1,7}$/.test(value.trim())) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return parsed >= min && parsed <= max ? parsed : null;
}

async function verifySeat(ctx: SignedInContext): Promise<Reply> {
  const person = ctx.session.person;
  return transaction(async (db) => {
    const { record } = await visibleAssignment(person, ctx.params.number ?? "", db, true);
    requireRole(ctx, "interpreter");
    const seat = seatOf(record, ctx);
    if (seat.holderId !== person.id) throw new ApiError("forbidden");
    if (seat.status === "served") throw new ApiError("already_verified");
    if (!["covered", "served"].includes(record.status)) throw new ApiError("invalid_transition");
    const fields = ctx.multipart?.fields ?? new Map<string, string>();
    const errors: FieldErrors = {};
    const actualMinutes = wholeNumber(fields.get("actual_minutes"), 1, 960);
    if (actualMinutes === null) errors.actual_minutes = "Enter the actual minutes worked, from 1 to 960.";
    const miles = wholeNumber(fields.get("round_trip_miles"), 0, 1000);
    if (miles === null) errors.round_trip_miles = "Enter the round-trip miles, from 0 to 1,000.";
    const file = ctx.multipart?.files.get("form");
    const type = file ? formType(file) : null;
    if (!type) errors.form = "Upload a PDF, JPEG or PNG file.";
    if (!file || !type || actualMinutes === null || miles === null) throw new ApiError("validation", errors);
    const key = `verifications/${record.number}/seat-${seat.seat}/${randomBytes(16).toString("hex")}.${type.extension}`;
    await s3Request("PUT", key, file.data, type.type);
    await db.query(
      `INSERT INTO verifications (assignment_id, seat, interpreter_id, actual_minutes, round_trip_miles, object_key,
                                  content_type, byte_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [record.id, seat.seat, person.id, actualMinutes, miles, key, type.type, file.data.length],
    );
    await db.query("UPDATE seats SET status = 'served' WHERE assignment_id = $1 AND seat = $2", [record.id, seat.seat]);
    await db.query(
      "UPDATE holds SET outcome = 'served', ended_at = now() WHERE assignment_id = $1 AND seat = $2 AND outcome = 'held'",
      [record.id, seat.seat],
    );
    const allServed = record.seats.every((s) => s.seat === seat.seat || s.status === "served");
    await db.query(
      `UPDATE assignments SET status = $2, billing_status = CASE WHEN $2 = 'verified' THEN 'ready' ELSE billing_status END
        WHERE id = $1`,
      [record.id, allServed ? "verified" : "served"],
    );
    return { status: 201, json: await present(await reloadAssignment(db, record.id), "holder", db) };
  });
}

async function storedForm(record: AssignmentRecord, seat: number): Promise<{ object_key: string; content_type: string }> {
  const stored = await pool.query<{ object_key: string; content_type: string }>(
    "SELECT object_key, content_type FROM verifications WHERE assignment_id = $1 AND seat = $2",
    [record.id, seat],
  );
  const row = stored.rows[0];
  if (!row) throw new ApiError("not_found");
  return row;
}

async function verificationLink(ctx: SignedInContext): Promise<Reply> {
  const person = ctx.session.person;
  const { record, kind } = await visibleAssignment(person, ctx.params.number ?? "");
  const seat = seatOf(record, ctx);
  // An interpreter may open only the form of their own seat; the organisation and agency staff may open any.
  if (kind === "offer" || (kind === "holder" && seat.holderId !== person.id)) throw new ApiError("not_found");
  const form = await storedForm(record, seat.seat);
  await s3Request("HEAD", form.object_key);
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO file_links (token_hash, session_token_hash, assignment_id, seat, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
    [hashToken(token), ctx.session.tokenHash, record.id, seat.seat, LINK_SECONDS],
  );
  return { status: 200, json: { url: `/files/${token}`, expires_in_seconds: LINK_SECONDS } };
}

async function downloadForm(ctx: SignedInContext): Promise<Reply> {
  const link = await pool.query<{ object_key: string; content_type: string; number: string; seat: number }>(
    `SELECT v.object_key, v.content_type, a.number, l.seat
       FROM file_links l
       JOIN verifications v ON v.assignment_id = l.assignment_id AND v.seat = l.seat
       JOIN assignments a ON a.id = l.assignment_id
      WHERE l.token_hash = $1 AND l.session_token_hash = $2 AND l.expires_at > now()`,
    [hashToken(ctx.params.token ?? ""), ctx.session.tokenHash],
  );
  const found = link.rows[0];
  if (!found) throw new ApiError("not_found");
  const extension = found.object_key.slice(found.object_key.lastIndexOf(".") + 1);
  return {
    status: 200,
    bytes: Buffer.from(await (await s3Request("GET", found.object_key)).arrayBuffer()),
    headers: {
      "Content-Type": found.content_type,
      "Content-Disposition": `attachment; filename="verification-${found.number}-seat-${found.seat}.${extension}"`,
      "Cache-Control": "no-store",
    },
  };
}

async function mySeats(ctx: SignedInContext): Promise<Reply> {
  const person = requireRole(ctx, "interpreter");
  const records = await loadAssignments(
    "EXISTS (SELECT 1 FROM seats st WHERE st.assignment_id = a.id AND st.holder_id = $1)",
    [person.id],
  );
  const held = records.filter((record) => viewFor(person, record, []) === "holder");
  return { status: 200, json: { assignments: await Promise.all(held.map((r) => present(r, "holder"))) } };
}

export function registerSeatRoutes(): void {
  route("POST", "/api/assignments/{number}/seats/{seat}/claim", claimSeat);
  route("POST", "/api/assignments/{number}/seats/{seat}/give-back", giveBackSeat);
  route("POST", "/api/assignments/{number}/seats/{seat}/verification", verifySeat, "multipart");
  route("GET", "/api/assignments/{number}/seats/{seat}/verification-link", verificationLink);
  route("GET", "/files/{token}", downloadForm);
  route("GET", "/api/my-seats", mySeats);
}
