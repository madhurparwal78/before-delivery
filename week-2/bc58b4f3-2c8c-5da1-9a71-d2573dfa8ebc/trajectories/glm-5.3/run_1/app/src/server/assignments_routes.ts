import { Pool } from "pg";
import { ApiError, validationError } from "./errors";
import { sendJson, FORM_FILE_LIMIT } from "./httpio";
import { Ctx, Router, requireIdempotencyKey, readJson } from "./router";
import { Config, Tx, withTx } from "./config";
import { requestHash } from "./db";
import {
  AssignmentRow, SeatRow, Caller, AssignmentInput,
  loadAssignment, loadSeats, loadBilling, loadCancellation, buildView, canSeeAssignment,
  loadCallerLanguages, validateAssignmentInput, validateTimeWindow, createAssignment, rebuildSeats,
  assignmentStatusAfterSeatChange, freshFormToken,
} from "./assignments";
import {
  RELEASE_FROM, CLAIM_FROM, GIVE_BACK_STATUSES, EDIT_DETAIL_STATUSES,
  VERIFY_STATUSES, CANCEL_FROM, assertTransition, serviceLine,
  cancellationFee, isLateNotice, rateInForce,
} from "./rules";
import { centralDateISO } from "../shared/time";
import { sendOfferEmails, sendClaimConfirmation, sendCoverageReceipt, sendCancellationNotices, sendTimeChangeNotices } from "./notify";
import { StorageUnavailable, putObject, randomObjectSuffix } from "./s3";

interface Deps {
  db: Pool;
  config: Config;
}

function asCaller(ctx: Ctx): Caller & { sessionToken: string; email: string; name: string } {
  const s = ctx.session!;
  return {
    id: s.id,
    role: s.role as Caller["role"],
    orgCode: s.orgCode,
    languages: [],
    sessionToken: s.sessionToken,
    email: s.email,
    name: s.name,
  };
}

/** Load an assignment visible to the caller or answer 404. */
async function visibleAssignment(tx: Tx, caller: Caller, number: string): Promise<AssignmentRow> {
  const a = await loadAssignment(tx, number);
  const languages = caller.role === "interpreter" ? await loadCallerLanguages(tx, caller.id) : [];
  const sees = await canSeeAssignment(tx, { ...caller, languages }, a);
  if (!sees) throw new ApiError("not_found", "No such request.");
  return a;
}

async function fullView(tx: Tx, caller: Caller, a: AssignmentRow, seats: SeatRow[]): Promise<Record<string, unknown>> {
  const cancellation = await loadCancellation(tx, a.id);
  const billing = await loadBilling(tx, a.id);
  if (caller.role === "dispatcher" || caller.role === "billing_lead") {
    return buildView(a, seats, { kind: "staff" }, { cancellation, billing });
  }
  if (caller.role === "scheduler" || caller.role === "org_admin") {
    return buildView(a, seats, { kind: "org" }, { cancellation, billing });
  }
  const held = seats.some((s) => s.holder_id === caller.id);
  return buildView(a, seats, held ? { kind: "holder" } : { kind: "offer" }, { cancellation, billing });
}

// ── POST /api/assignments ─────────────────────────────────────────────────────

async function handleCreate(ctx: Ctx, deps: Deps): Promise<void> {
  const caller = asCaller(ctx);
  const key = requireIdempotencyKey(ctx);
  const body = readJson(ctx);
  const hash = requestHash(body);

  await withTx(deps.db, async (tx) => {
    // 6. idempotent replay / conflict before validation and creation.
    const existing = await tx.query(
      `SELECT request_hash, response_json FROM idempotency WHERE scheduler_id = $1 AND key = $2`,
      [caller.id, key],
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0] as { request_hash: string; response_json: string };
      if (row.request_hash !== hash) {
        throw new ApiError("idempotency_conflict", "This request was already submitted with different details.");
      }
      sendJson(ctx.res, 201, JSON.parse(row.response_json), { "Idempotent-Replay": "true" });
      return;
    }

    // 8. validation.
    const now = new Date();
    const partial = validateAssignmentInput(body, now, false);
    const input: AssignmentInput = {
      language: partial.language as string,
      setting: partial.setting as string,
      start_at: partial.start_at as string,
      duration_minutes: partial.duration_minutes as number,
      street_address: partial.street_address as string,
      city: partial.city as string,
      patient_initials: partial.patient_initials as string,
      medical_notes: partial.medical_notes ?? "",
    };

    const created = await createAssignment(tx, caller.id, caller.orgCode!, input);
    const seats = await loadSeats(tx, created.id);
    const view = buildView(created, seats, { kind: "org" }, { cancellation: null, billing: { status: "none", invoice_id: null, total_cents: null } });
    const responseJson = JSON.stringify(view);
    await tx.query(
      `INSERT INTO idempotency (scheduler_id, key, request_hash, response_json) VALUES ($1,$2,$3,$4)`,
      [caller.id, key, hash, responseJson],
    );
    sendJson(ctx.res, 201, view);
  });
}

// ── GET /api/assignments ─────────────────────────────────────────────────────

async function handleList(ctx: Ctx, deps: Deps): Promise<void> {
  const caller = asCaller(ctx);
  const q = (ctx.query.get("q") ?? "").trim().toLowerCase();
  await withTx(deps.db, async (tx) => {
    const params: unknown[] = [];
    let sql = `
      SELECT a.number, a.id FROM assignments a
    `;
    const where: string[] = [];
    if (caller.role === "scheduler" || caller.role === "org_admin") {
      params.push(caller.orgCode);
      where.push(`a.org_code = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(lower(a.number) LIKE $${params.length} OR lower(a.city) LIKE $${params.length})`);
    }
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY a.start_at ASC, a.id ASC";
    const res = await tx.query(sql, params);
    const views: Record<string, unknown>[] = [];
    const languages = caller.role === "interpreter" ? await loadCallerLanguages(tx, caller.id) : [];
    for (const row of res.rows as { number: string; id: number }[]) {
      const a = await loadAssignment(tx, row.number);
      const sees = await canSeeAssignment(tx, { ...caller, languages }, a);
      if (!sees) continue;
      const seats = await loadSeats(tx, a.id);
      views.push(await fullView(tx, caller, a, seats));
    }
    sendJson(ctx.res, 200, { assignments: views });
  });
}

// ── GET /api/assignments/{number} ────────────────────────────────────────────

async function handleGet(ctx: Ctx, deps: Deps): Promise<void> {
  const caller = asCaller(ctx);
  await withTx(deps.db, async (tx) => {
    const a = await visibleAssignment(tx, caller, ctx.params.number);
    const seats = await loadSeats(tx, a.id);
    sendJson(ctx.res, 200, await fullView(tx, caller, a, seats));
  });
}

// ── PATCH /api/assignments/{number} ───────────────────────────────────────────

async function handlePatch(ctx: Ctx, deps: Deps): Promise<void> {
  const caller = asCaller(ctx);
  const body = readJson(ctx);
  await withTx(deps.db, async (tx) => {
    const a = await loadAssignment(tx, ctx.params.number);
    if (a.org_code !== caller.orgCode) throw new ApiError("not_found", "No such request.");
    // A scheduler can see it; changing is allowed in the edit statuses only.
    assertTransition(a.status, EDIT_DETAIL_STATUSES, "change");

    const timeChanging = body.start_at !== undefined || body.duration_minutes !== undefined;
    if (timeChanging && isLateNotice(new Date(), a.start_at)) {
      throw new ApiError("late_change", "Less than 48 business hours' notice.");
    }

    // Validate only the fields the patch carries.
    const cleanedPatch = validateAssignmentInput(body, new Date(), true);

    const newStartISO = cleanedPatch.start_at ?? isoCurrent(a.start_at);
    const newDuration = cleanedPatch.duration_minutes ?? a.duration_minutes;
    if (timeChanging) {
      const startAt = parseISO(newStartISO);
      validateTimeWindow(startAt, newDuration, new Date());
    }

    const startAt = parseISO(newStartISO);
    const endAt = new Date(startAt.getTime() + newDuration * 60000);

    const freedBefore = await loadSeats(tx, a.id);
    const freed = freedBefore.filter((s) => s.status !== "open");

    await tx.query(
      `UPDATE assignments SET start_at=$1, end_at=$2, duration_minutes=$3,
              street_address=$4, city=$5, medical_notes=$6, updated_at=now()
        WHERE id=$7`,
      [
        startAt, endAt, newDuration,
        cleanedPatch.street_address ?? a.street_address,
        cleanedPatch.city ?? a.city,
        cleanedPatch.medical_notes ?? a.medical_notes,
        a.id,
      ],
    );

    if (timeChanging) {
      await rebuildSeats(tx, a.id, a.language_code, newDuration);
      const status = a.status === "draft" ? "draft" : "released";
      await tx.query(`UPDATE assignments SET status=$1 WHERE id=$2`, [status, a.id]);
    }

    const updated = await loadAssignment(tx, a.number);

    if (timeChanging && a.status !== "draft") {
      // One notice to the scheduler and each interpreter whose seat was freed, then re-offer.
      const schedulerEmail = (await tx.query(`SELECT email FROM people WHERE id = $1`, [a.scheduler_id])).rows[0].email as string;
      const freedEmails: { email: string; name: string }[] = [];
      for (const s of freed) {
        if (s.holder_id) {
          const r = await tx.query(`SELECT email, name FROM people WHERE id = $1`, [s.holder_id]);
          if (r.rows[0]) freedEmails.push(r.rows[0] as { email: string; name: string });
        }
      }
      await sendTimeChangeNotices(tx, updated, schedulerEmail, freedEmails);
      await sendOfferEmails(tx, updated);
    }

    const seats = await loadSeats(tx, a.id);
    const view = buildView(updated, seats, { kind: "org" }, { cancellation: await loadCancellation(tx, updated.id), billing: await loadBilling(tx, updated.id) });
    sendJson(ctx.res, 200, view);
  });
}

function isoCurrent(date: Date): string {
  return date.toISOString();
}

function parseISO(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ApiError("validation", "Enter a valid time.", { start_at: "Enter a valid time." });
  return d;
}

// ── POST /api/assignments/{number}/release ────────────────────────────────────

async function handleRelease(ctx: Ctx, deps: Deps): Promise<void> {
  const caller = asCaller(ctx);
  await withTx(deps.db, async (tx) => {
    const a = await loadAssignment(tx, ctx.params.number);
    // Dispatcher-only action on a visible resource.
    if (caller.role !== "dispatcher") throw new ApiError("forbidden", "Only a dispatcher can release.");
    assertTransition(a.status, RELEASE_FROM, "release");
    await tx.query(`UPDATE assignments SET status='released', updated_at=now() WHERE id=$1`, [a.id]);
    const updated = await loadAssignment(tx, a.number);
    const seats = await loadSeats(tx, a.id);
    const offers = await sendOfferEmails(tx, updated);
    const view = buildView(updated, seats, { kind: "staff" }, { cancellation: null, billing: await loadBilling(tx, a.id) });
    sendJson(ctx.res, 200, { assignment: view, offers_sent: offers });
  });
}

// ── GET /api/offers, /api/my-seats ────────────────────────────────────────────

async function handleOffers(ctx: Ctx, deps: Deps): Promise<void> {
  const caller = asCaller(ctx);
  await withTx(deps.db, async (tx) => {
    const langs = await loadCallerLanguages(tx, caller.id);
    const res = await tx.query(
      `SELECT a.number FROM assignments a
        WHERE a.language_code = ANY($1)
          AND a.status IN ('released','partially_covered')
          AND a.start_at > now()
        ORDER BY a.start_at ASC, a.id ASC`,
      [langs],
    );
    const views: Record<string, unknown>[] = [];
    for (const row of res.rows as { number: string }[]) {
      const a = await loadAssignment(tx, row.number);
      const seats = await loadSeats(tx, a.id);
      views.push(buildView(a, seats, { kind: "offer" }, { cancellation: null, billing: { status: "none", invoice_id: null, total_cents: null } }));
    }
    sendJson(ctx.res, 200, { offers: views });
  });
}

async function handleMySeats(ctx: Ctx, deps: Deps): Promise<void> {
  const caller = asCaller(ctx);
  await withTx(deps.db, async (tx) => {
    const res = await tx.query(
      `SELECT DISTINCT a.number
         FROM assignments a JOIN seats st ON st.assignment_id = a.id
        WHERE st.holder_id = $1
        ORDER BY a.number`,
      [caller.id],
    );
    const views: Record<string, unknown>[] = [];
    for (const row of res.rows as { number: string }[]) {
      const a = await loadAssignment(tx, row.number);
      const seats = await loadSeats(tx, a.id);
      views.push(buildView(a, seats, { kind: "holder" }, { cancellation: await loadCancellation(tx, a.id), billing: await loadBilling(tx, a.id) }));
    }
    sendJson(ctx.res, 200, { assignments: views });
  });
}

// ── Claim and give back ───────────────────────────────────────────────────────

async function handleClaim(ctx: Ctx, deps: Deps): Promise<void> {
  const caller = asCaller(ctx);
  const seatNo = Number(ctx.params.seat);
  await withTx(deps.db, async (tx) => {
    const a = await loadAssignment(tx, ctx.params.number);
    const langs = await loadCallerLanguages(tx, caller.id);
    if (!langs.includes(a.language_code)) throw new ApiError("not_found", "No such request.");
    // Serialise claims on this assignment so exactly one of any number wins.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [a.number]);
    const seats = await loadSeats(tx, a.id);
    const target = seats.find((s) => s.seat === seatNo);
    if (!target) throw new ApiError("not_found", "No such seat.");
    if (!CLAIM_FROM.includes(a.status) || target.status !== "open") {
      throw new ApiError("seat_taken", "Seat already taken.");
    }
    const alreadyHolding = seats.some((s) => s.holder_id === caller.id);
    if (alreadyHolding) throw new ApiError("already_holding", "You already hold a seat on this request.");
    // Overlap check across the interpreter's other held seats.
    const overlap = await tx.query(
      `SELECT 1
         FROM seats st JOIN assignments a2 ON a2.id = st.assignment_id
        WHERE st.holder_id = $1
          AND a2.id <> $2
          AND a2.status <> 'cancelled'
          AND a2.start_at < $3 AND a2.end_at > $4
        LIMIT 1`,
      [caller.id, a.id, a.end_at, a.start_at],
    );
    if (overlap.rows.length > 0) throw new ApiError("calendar_conflict", "This overlaps a seat you already hold.");
    await tx.query(`UPDATE seats SET status='held', holder_id=$1 WHERE id=$2`, [caller.id, target.id]);
    const openLeft = seats.filter((s) => s.id !== target.id && s.status === "open").length;
    const newStatus = openLeft === 0 ? "covered" : "partially_covered";
    await tx.query(`UPDATE assignments SET status=$1, updated_at=now() WHERE id=$2`, [newStatus, a.id]);
    const updated = await loadAssignment(tx, a.number);
    const updatedSeats = await loadSeats(tx, a.id);
    const view = buildView(updated, updatedSeats, { kind: "holder" }, { cancellation: null, billing: { status: "none", invoice_id: null, total_cents: null } });
    sendJson(ctx.res, 200, view);
    // Confirmation email to the claimer; coverage receipt when fully covered.
    const interp = await tx.query(`SELECT email, name FROM people WHERE id = $1`, [caller.id]);
    await sendClaimConfirmation(tx, updated, seatNo, interp.rows[0] as { email: string; name: string });
    if (newStatus === "covered") {
      const schedEmail = await tx.query(`SELECT email FROM people WHERE id = $1`, [updated.scheduler_id]);
      await sendCoverageReceipt(tx, updated, updatedSeats, schedEmail.rows[0].email as string);
    }
  });
}

async function handleGiveBack(ctx: Ctx, deps: Deps): Promise<void> {
  const caller = asCaller(ctx);
  await withTx(deps.db, async (tx) => {
    const a = await loadAssignment(tx, ctx.params.number);
    const langs = await loadCallerLanguages(tx, caller.id);
    const sees = await canSeeAssignment(tx, { ...caller, languages: langs }, a);
    if (!sees) throw new ApiError("not_found", "No such request.");
    const seatNo = Number(ctx.params.seat);
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [a.number]);
    const seats = await loadSeats(tx, a.id);
    const target = seats.find((s) => s.seat === seatNo);
    if (!target) throw new ApiError("not_found", "No such seat.");
    if (target.holder_id !== caller.id) throw new ApiError("forbidden", "This is not your seat.");
    if (!GIVE_BACK_STATUSES.includes(a.status) || target.status !== "held") {
      throw new ApiError("invalid_transition", "This seat can no longer be given back.");
    }
    await tx.query(`UPDATE seats SET status='open', holder_id=NULL WHERE id=$1`, [target.id]);
    await tx.query(`INSERT INTO hold_history (seat_id, person_id, event) VALUES ($1,$2,'released_back')`, [target.id, caller.id]);
    const newStatus = await assignmentStatusAfterSeatChange(tx, a.id);
    await tx.query(`UPDATE assignments SET status=$1, updated_at=now() WHERE id=$2`, [newStatus, a.id]);
    const updated = await loadAssignment(tx, a.number);
    const updatedSeats = await loadSeats(tx, a.id);
    sendJson(ctx.res, 200, buildView(updated, updatedSeats, { kind: "offer" }, { cancellation: null, billing: { status: "none", invoice_id: null, total_cents: null } }));
  });
}

// ── Cancellation ───────────────────────────────────────────────────────────────

async function handleQuote(ctx: Ctx, deps: Deps): Promise<void> {
  const caller = asCaller(ctx);
  await withTx(deps.db, async (tx) => {
    const a = await loadAssignment(tx, ctx.params.number);
    if (a.org_code !== caller.orgCode) throw new ApiError("not_found", "No such request.");
    assertTransition(a.status, CANCEL_FROM, "cancel");
    const seats = await loadSeats(tx, a.id);
    const rate = await rateInForce(tx, a.org_code, serviceLine(a.language_code), centralDateISO(a.start_at));
    const decision = cancellationFee(a.status, new Date(), a.start_at, seats.length, rate.hourly_rate_cents);
    sendJson(ctx.res, 200, {
      fee_applies: decision.fee_applies,
      business_minutes_notice: decision.business_minutes_notice,
      fee_cents: decision.fee_cents,
    });
  });
}

async function handleCancel(ctx: Ctx, deps: Deps): Promise<void> {
  const caller = asCaller(ctx);
  await withTx(deps.db, async (tx) => {
    const a = await loadAssignment(tx, ctx.params.number);
    if (a.org_code !== caller.orgCode) throw new ApiError("not_found", "No such request.");
    assertTransition(a.status, CANCEL_FROM, "cancel");
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [a.number]);
    const seats = await loadSeats(tx, a.id);
    const rate = await rateInForce(tx, a.org_code, serviceLine(a.language_code), centralDateISO(a.start_at));
    const receivedAt = new Date();
    const decision = cancellationFee(a.status, receivedAt, a.start_at, seats.length, rate.hourly_rate_cents);
    await tx.query(`UPDATE assignments SET status='cancelled', updated_at=now() WHERE id=$1`, [a.id]);
    await tx.query(
      `INSERT INTO cancellations (assignment_id, cancelled_at, fee_applies, business_minutes_notice, fee_cents)
       VALUES ($1,$2,$3,$4,$5)`,
      [a.id, receivedAt, decision.fee_applies, decision.business_minutes_notice, decision.fee_cents],
    );
    if (decision.fee_applies) {
      await tx.query(`INSERT INTO audit_log (kind, detail) VALUES ('cancellation_fee', $1)`, [
        JSON.stringify({ number: a.number, fee_cents: decision.fee_cents, notice: decision.business_minutes_notice }),
      ]);
      await tx.query(
        `INSERT INTO billing (assignment_id, status) VALUES ($1,'ready')
         ON CONFLICT (assignment_id) DO UPDATE SET status='ready'`,
        [a.id],
      );
    }
    const updated = await loadAssignment(tx, a.number);
    const updatedSeats = await loadSeats(tx, a.id);
    const view = buildView(updated, updatedSeats, { kind: "org" }, { cancellation: await loadCancellation(tx, a.id), billing: await loadBilling(tx, a.id) });
    sendJson(ctx.res, 200, view);
    // One notice to the scheduler and each holder.
    const schedEmail = await tx.query(`SELECT email FROM people WHERE id = $1`, [a.scheduler_id]);
    const holders: { email: string; name: string }[] = [];
    for (const s of seats) {
      if (s.holder_id) {
        const r = await tx.query(`SELECT email, name FROM people WHERE id = $1`, [s.holder_id]);
        if (r.rows[0]) holders.push(r.rows[0] as { email: string; name: string });
      }
    }
    await sendCancellationNotices(tx, updated, decision.fee_applies, decision.fee_cents, schedEmail.rows[0].email as string, holders);
  });
}

// ── Verification ───────────────────────────────────────────────────────────────

const ALLOWED_FORM_TYPES: { declared: string; sniffed: string; ext: string }[] = [
  { declared: "application/pdf", sniffed: "pdf", ext: "pdf" },
  { declared: "image/jpeg", sniffed: "jpeg", ext: "jpg" },
  { declared: "image/png", sniffed: "png", ext: "png" },
];

function sniffFormType(data: Buffer): string | null {
  if (data.length >= 5 && data.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  return null;
}

async function handleVerification(ctx: Ctx, deps: Deps): Promise<void> {
  const caller = asCaller(ctx);
  const parts = ctx.body?.multipart ?? { fields: new Map(), files: new Map() };
  if (!parts) throw new ApiError("unsupported_media_type", "Send multipart/form-data.");
  const fields = parts.fields;
  const file = parts.files.get("form");

  const minutesRaw = fields.get("actual_minutes");
  const milesRaw = fields.get("round_trip_miles");
  const fieldErrors: Record<string, string> = {};
  let actualMinutes: number | null = null;
  let roundTripMiles: number | null = null;
  if (minutesRaw !== undefined && /^\d+$/.test(minutesRaw) && Number(minutesRaw) >= 1 && Number(minutesRaw) <= 960) {
    actualMinutes = Number(minutesRaw);
  } else {
    fieldErrors.actual_minutes = "Enter whole minutes from 1 to 960.";
  }
  if (milesRaw !== undefined && /^\d+$/.test(milesRaw) && Number(milesRaw) >= 0 && Number(milesRaw) <= 1000) {
    roundTripMiles = Number(milesRaw);
  } else {
    fieldErrors.round_trip_miles = "Enter whole miles from 0 to 1,000.";
  }
  if (!file) {
    fieldErrors.form = "Attach the signed verification form.";
  } else if (file.data.length > FORM_FILE_LIMIT) {
    sendJson(ctx.res, 413, { error: { code: "payload_too_large", message: "The file is larger than 5,000,000 bytes." } });
    return;
  } else {
    const sniffed = sniffFormType(file.data);
    const match = sniffed ? ALLOWED_FORM_TYPES.find((t) => t.sniffed === sniffed && t.declared === file.contentType) : null;
    if (!match) {
      fieldErrors.form = "Upload a PDF, JPEG or PNG file.";
    }
  }
  if (Object.keys(fieldErrors).length > 0) throw validationError(fieldErrors);
  const formFile = file as { data: Buffer; filename: string; contentType: string };

  await withTx(deps.db, async (tx) => {
    const a = await loadAssignment(tx, ctx.params.number);
    const seatNo = Number(ctx.params.seat);
    const seats = await loadSeats(tx, a.id);
    const target = seats.find((s) => s.seat === seatNo);
    if (!target) throw new ApiError("not_found", "No such seat.");
    if (target.holder_id !== caller.id) throw new ApiError("forbidden", "This is not your seat.");
    if (target.status === "served") throw new ApiError("already_verified", "This seat is already verified.");
    if (!VERIFY_STATUSES.includes(a.status)) throw new ApiError("invalid_transition", "This seat cannot be verified now.");

    const sniffed = sniffFormType(formFile.data)!;
    const kind = ALLOWED_FORM_TYPES.find((t) => t.sniffed === sniffed)!;
    const key = `verifications/${a.number}/seat-${seatNo}/${randomObjectSuffix()}.${kind.ext}`;
    // Store in MinIO first; nothing changes when storage is down.
    try {
      await putObject(deps.config, key, formFile.data, kind.declared);
    } catch (e) {
      if (e instanceof StorageUnavailable) throw new ApiError("storage_unavailable", "File storage is unavailable. Your form was not saved. Try again shortly.");
      throw e;
    }
    await tx.query(
      `UPDATE seats SET status='served', actual_minutes=$1, round_trip_miles=$2,
              form_object_key=$3, form_content_type=$4, form_size=$5, verified_at=now()
        WHERE id=$6`,
      [actualMinutes, roundTripMiles, key, kind.declared, formFile.data.length, target.id],
    );
    const updatedSeats = await loadSeats(tx, a.id);
    const allServed = updatedSeats.every((s) => s.status === "served");
    const newStatus = allServed ? "verified" : "served";
    await tx.query(`UPDATE assignments SET status=$1, updated_at=now() WHERE id=$2`, [newStatus, a.id]);
    if (allServed) {
      await tx.query(
        `INSERT INTO billing (assignment_id, status) VALUES ($1,'ready')
         ON CONFLICT (assignment_id) DO UPDATE SET status='ready'`,
        [a.id],
      );
    }
    const updated = await loadAssignment(tx, a.number);
    const seatsAfter = await loadSeats(tx, a.id);
    sendJson(ctx.res, 201, buildView(updated, seatsAfter, { kind: "holder" }, { cancellation: null, billing: { status: "none", invoice_id: null, total_cents: null } }));
  });
}

// ── Verification link ─────────────────────────────────────────────────────────

async function handleVerificationLink(ctx: Ctx, deps: Deps): Promise<void> {
  const caller = asCaller(ctx);
  await withTx(deps.db, async (tx) => {
    const a = await loadAssignment(tx, ctx.params.number);
    const seatNo = Number(ctx.params.seat);
    const seats = await loadSeats(tx, a.id);
    const target = seats.find((s) => s.seat === seatNo);
    if (!target) throw new ApiError("not_found", "No such seat.");

    let allowed = false;
    if (caller.role === "dispatcher" || caller.role === "billing_lead") allowed = true;
    else if (caller.role === "scheduler" || caller.role === "org_admin") allowed = a.org_code === caller.orgCode;
    else if (caller.role === "interpreter") allowed = target.holder_id === caller.id;
    if (!allowed) throw new ApiError("not_found", "No such request.");
    if (!target.form_object_key) throw new ApiError("not_found", "No form stored yet.");

    const token = freshFormToken();
    await tx.query(
      `INSERT INTO form_links (token, seat_id, session_token, expires_at)
       VALUES ($1,$2,$3, now() + interval '60 seconds')`,
      [token, target.id, caller.sessionToken],
    );
    sendJson(ctx.res, 200, { url: `/files/${token}`, expires_in_seconds: 60 });
  });
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerAssignmentRoutes(router: Router, deps: Deps): void {
  router.add("POST", "/api/assignments", {
    body: "json", roles: ["scheduler"],
    handler: (ctx) => handleCreate(ctx, deps),
  });
  router.add("GET", "/api/assignments", {
    roles: ["scheduler", "org_admin", "dispatcher", "billing_lead"],
    handler: (ctx) => handleList(ctx, deps),
  });
  router.add("GET", "/api/assignments/:number", {
    roles: ["scheduler", "org_admin", "dispatcher", "billing_lead", "interpreter"],
    handler: (ctx) => handleGet(ctx, deps),
  });
  router.add("PATCH", "/api/assignments/:number", {
    body: "json", roles: ["scheduler"],
    handler: (ctx) => handlePatch(ctx, deps),
  });
  router.add("POST", "/api/assignments/:number/release", {
    body: "json", roles: ["dispatcher"],
    handler: (ctx) => handleRelease(ctx, deps),
  });
  router.add("GET", "/api/offers", {
    roles: ["interpreter"],
    handler: (ctx) => handleOffers(ctx, deps),
  });
  router.add("GET", "/api/my-seats", {
    roles: ["interpreter"],
    handler: (ctx) => handleMySeats(ctx, deps),
  });
  router.add("POST", "/api/assignments/:number/seats/:seat/claim", {
    body: "json", roles: ["interpreter"],
    handler: (ctx) => handleClaim(ctx, deps),
  });
  router.add("POST", "/api/assignments/:number/seats/:seat/give-back", {
    body: "json", roles: ["interpreter"],
    handler: (ctx) => handleGiveBack(ctx, deps),
  });
  router.add("GET", "/api/assignments/:number/cancellation-quote", {
    roles: ["scheduler"],
    handler: (ctx) => handleQuote(ctx, deps),
  });
  router.add("POST", "/api/assignments/:number/cancel", {
    body: "json", roles: ["scheduler"],
    handler: (ctx) => handleCancel(ctx, deps),
  });
  router.add("POST", "/api/assignments/:number/seats/:seat/verification", {
    body: "multipart", roles: ["interpreter"],
    handler: (ctx) => handleVerification(ctx, deps),
  });
  router.add("GET", "/api/assignments/:number/seats/:seat/verification-link", {
    roles: ["scheduler", "org_admin", "dispatcher", "billing_lead", "interpreter"],
    handler: (ctx) => handleVerificationLink(ctx, deps),
  });
}
