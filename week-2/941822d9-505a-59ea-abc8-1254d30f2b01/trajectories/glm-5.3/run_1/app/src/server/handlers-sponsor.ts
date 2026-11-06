import { randomUUID } from "node:crypto";
import { err, notFound, validationError } from "./errors.ts";
import { query, withSerializable, withTransaction, pool } from "./db.ts";
import { serialiseCoverage, serialiseEnrolment, serialisePack } from "./dto.ts";
import { percentHundredths, centsToMoney } from "./money.ts";
import { policyInEffect, scheduledChange } from "./coverage.ts";
import { expirePackIfDue, packBalance, packExpiryInstant, postMovement, sponsorSeatTotals } from "./packs.ts";
import { cohortOpen } from "./cohorts.ts";
import { findCourse } from "./handlers-courses.ts";
import { validateKey, withIdempotency } from "./idempotency.ts";
import { putObject, getObject } from "./storage.ts";
import { isIsoDate, providerToday } from "./time.ts";
import { loadEnrolment, enrolmentModules } from "./handlers-checkout.ts";
import { loadCertificate, serialiseCertificateDto } from "./handlers-learning.ts";
import type { Ctx } from "./route.ts";
import { uuidOr404 } from "./validation.ts";
import { pathParam } from "./route.ts";
import type { PoolClient } from "pg";
import { PaymentsUnavailable, purchase } from "./payments.ts";

type Hospital = { id: string; name: string; slug: string };

async function myHospital(ctx: Ctx): Promise<Hospital> {
  if (ctx.user.role !== "coordinator" || ctx.user.organisation_id === null) throw notFound();
  const { rows } = await query<Hospital>(
    `SELECT id, name, slug FROM organisations WHERE id = $1 AND kind = 'hospital'`,
    [ctx.user.organisation_id],
  );
  const hospital = rows[0];
  if (!hospital) throw notFound();
  return hospital;
}

export async function sponsorDashboard(ctx: Ctx): Promise<void> {
  const hospital = await myHospital(ctx);
  await withSerializable(async (client) => {
    await expireDuePacks(client, hospital.id);
  });
  const totals = await sponsorTotalsFor(hospital.id);
  const coverage = await coverageFor(hospital.id);
  ctx.res.json({
    ...totals,
    coverage,
  });
};

async function sponsorTotalsFor(hospitalId: string): Promise<{ seats_purchased: number; seats_assigned: number; seats_available: number; seats_expired: number; completions: number; hours_awarded: string }> {
  const client = await pool.connect();
  try {
    const seats = await sponsorSeatTotals(client, hospitalId);
    const { rows } = await client.query<{ completions: string; hours: string }>(
      `SELECT count(*)::text AS completions, COALESCE(sum(c.contact_hours_h),0)::text AS hours
         FROM certificates c
         JOIN enrolments e ON e.id = c.enrolment_id
        WHERE c.state = 'sealed' AND e.funding IN ('seat','co_pay') AND e.hospital_id = $1`,
      [hospitalId],
    );
    return {
      ...seats,
      completions: Number(rows[0]?.completions ?? 0),
      hours_awarded: ((Number(rows[0]?.hours ?? 0)) / 100).toFixed(2),
    };
  } finally {
    client.release();
  }
}

async function coverageFor(hospitalId: string): Promise<Record<string, unknown>> {
  const policy = await policyInEffect({ query }, hospitalId);
  const scheduled = await scheduledChange({ query }, hospitalId);
  return serialiseCoverage({
    coverage_percent_h: policy.percentH,
    scheduled_percent_h: scheduled?.percentH ?? null,
    scheduled_on: scheduled?.effectiveOn ?? null,
  });
}

async function expireDuePacks(client: PoolClient, hospitalId: string): Promise<void> {
  const { rows } = await client.query<{ id: string; expires_at: Date; expired: boolean }>(
    `SELECT id, expires_at, expired FROM packs WHERE hospital_id = $1`,
    [hospitalId],
  );
  for (const pack of rows) {
    await expirePackIfDue(client, { id: pack.id, expires_at: new Date(pack.expires_at), expired: pack.expired });
  }
}

export async function saveCoverage(ctx: Ctx): Promise<void> {
  const hospital = await myHospital(ctx);
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (key !== "coverage_percent" && key !== "effective_on") errors[key] = "This field is not accepted.";
  }
  const percentH = percentHundredths(body.coverage_percent);
  if (percentH === null) errors.coverage_percent = "Enter a percentage from 0 to 100 with at most two decimals.";
  const effectiveOn = body.effective_on;
  const today = providerToday();
  if (typeof effectiveOn !== "string" || !isIsoDate(effectiveOn) || effectiveOn < today) {
    errors.effective_on = "Choose today or a later date.";
  }
  if (percentH === null || typeof effectiveOn !== "string" || Object.keys(errors).length > 0) {
    throw validationError(errors);
  }
  const effectiveDate = effectiveOn;

  await withSerializable(async (client) => {
    if (effectiveDate === today) {
      await client.query(
        `INSERT INTO coverage_policies (id, hospital_id, coverage_percent, effective_from, effective_on)
         VALUES (gen_random_uuid(), $1, $2, now(), $3)`,
        [hospital.id, (percentH / 100).toFixed(2), effectiveDate],
      );
    } else {
      await client.query(
        `INSERT INTO coverage_scheduled (hospital_id, coverage_percent, effective_on)
         VALUES ($1, $2, $3)
         ON CONFLICT (hospital_id) DO UPDATE SET coverage_percent = EXCLUDED.coverage_percent, effective_on = EXCLUDED.effective_on`,
        [hospital.id, (percentH / 100).toFixed(2), effectiveDate],
      );
    }
  });
  ctx.res.json(await coverageFor(hospital.id));
}

export async function listPacks(ctx: Ctx): Promise<void> {
  const hospital = await myHospital(ctx);
  await withSerializable(async (client) => {
    await expireDuePacks(client, hospital.id);
  });
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM packs WHERE hospital_id = $1 ORDER BY purchased_at DESC`,
    [hospital.id],
  );
  const list = [];
  for (const r of rows) {
    const pack = await loadPack(r.id, hospital.id);
    if (pack) list.push(serialisePack(pack));
  }
  ctx.res.json({ packs: list });
}

type PackRecord = {
  id: string;
  course_id: string;
  course_title: string;
  seats: number;
  price_cents: number;
  purchased_at: Date;
  expires_at: Date;
  state: "active" | "expired";
  expired: boolean;
  balance: number;
};

async function loadPack(id: string, hospitalId: string | null): Promise<PackRecord | null> {
  const { rows } = await query<PackRecord & { expired: boolean }>(
    `SELECT p.id, p.course_id, c.title AS course_title, p.seats, p.price_cents, p.purchased_at, p.expires_at, p.expired,
            COALESCE((SELECT sum(e.seats) FROM ledger_entries e WHERE e.pack_id = p.id AND e.account = 'pack'), 0)::int AS balance
       FROM packs p JOIN courses c ON c.id = p.course_id
      WHERE p.id = $1 AND ($2::uuid IS NULL OR p.hospital_id = $2)`,
    [id, hospitalId],
  );
  const row = rows[0];
  return row ? { ...row, state: row.expired ? "expired" : "active" } : null;
}

export async function buyPack(ctx: Ctx): Promise<void> {
  const hospital = await myHospital(ctx);
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const courseId = typeof body.course_id === "string" ? body.course_id : "";
  const course = await findCourse(courseId);
  if (!course) throw notFound();
  if (course.state !== "published" && course.state !== "withdrawn") throw notFound();

  const key = validateKey((ctx.req.headers["idempotency-key"] as string | undefined) ?? undefined);

  const outcome = await withIdempotency(ctx.user.id, key, "pack", body, async () => performPackPurchase(ctx, hospital, course, body));
  if ("replay" in outcome && outcome.replay) {
    ctx.res.status(outcome.response.status).json(outcome.response.body);
    return;
  }
  await outcome.store({ status: outcome.result.status, body: outcome.result.body });
  ctx.res.status(outcome.result.status).json(outcome.result.body);
}

async function performPackPurchase(ctx: Ctx, hospital: Hospital, course: NonNullable<Awaited<ReturnType<typeof findCourse>>>, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  if (course.state !== "published") throw err(409, "course_not_open");

  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (key !== "course_id" && key !== "seats") errors[key] = "This field is not accepted.";
  }
  const seats = typeof body.seats === "number" && Number.isInteger(body.seats) ? body.seats : null;
  if (seats === null || seats < 1 || seats > 500) errors.seats = "Buy from 1 to 500 seats.";
  if (course.format === "cohort") errors.course_id = "Seat packs are sold for self-paced courses only.";
  if (Object.keys(errors).length > 0) throw validationError(errors);

  const totalCents = course.list_price_cents * (seats ?? 0);
  const packId = randomUUID();
  const expiresAt = packExpiryInstant(new Date());

  try {
    await purchase(`credwell-hospital-${hospital.slug}`, hospital.name, totalCents, `pack-${packId}`, ctx.user.id);
  } catch (e) {
    if (e instanceof PaymentsUnavailable) throw err(503, "payments_unavailable");
    throw e;
  }

  await withSerializable(async (client) => {
    await client.query(
      `INSERT INTO packs (id, hospital_id, course_id, seats, price_cents, purchased_at, expires_at, expired)
       VALUES ($1, $2, $3, $4, $5, now(), $6, false)`,
      [packId, hospital.id, course.id, seats, totalCents, expiresAt],
    );
    await postMovement(client, packId, "purchase", [
      { account: "pack", seats: seats ?? 0 },
      { account: "purchases", seats: -(seats ?? 0) },
    ], null);
  });

  const pack = await loadPack(packId, hospital.id);
  if (!pack) throw new Error("pack missing after purchase");
  return { status: 201, body: { pack: serialisePack(pack) } };
}

export async function packLedger(ctx: Ctx): Promise<void> {
  const hospital = await myHospital(ctx);
  const pack = await loadPack(uuidOr404(pathParam(ctx, "id")), hospital.id);
  if (!pack) throw notFound();
  await withSerializable(async (client) => {
    await expirePackIfDue(client, { id: pack.id, expires_at: new Date(pack.expires_at), expired: pack.expired });
  });
  const fresh = await loadPack(pack.id, hospital.id);
  if (!fresh) throw notFound();
  const { rows } = await query<{ movement_id: string; kind: string; account: string; seats: number; assignment_id: string | null; posted_at: Date; seq: string }>(
    `SELECT m.id AS movement_id, m.kind, e.account, e.seats, m.assignment_id, m.posted_at, m.seq::text AS seq
       FROM ledger_movements m JOIN ledger_entries e ON e.movement_id = m.id
      WHERE m.pack_id = $1
      ORDER BY m.seq, CASE WHEN e.account = 'pack' THEN 0 ELSE 1 END`,
    [pack.id],
  );
  ctx.res.json({
    pack_id: pack.id,
    balance: fresh.balance,
    entries: rows.map((r) => ({
      movement_id: r.movement_id,
      kind: r.kind,
      account: r.account,
      seats: r.seats,
      assignment_id: r.assignment_id,
      posted_at: r.posted_at.toISOString(),
    })),
  });
}

export async function assignSeat(ctx: Ctx): Promise<void> {
  const hospital = await myHospital(ctx);
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (key !== "nurse_id") errors[key] = "This field is not accepted.";
  }
  const pack = await loadPack(uuidOr404(pathParam(ctx, "id")), hospital.id);
  if (!pack) throw notFound();

  const nurseId = typeof body.nurse_id === "string" ? body.nurse_id : "";
  const { rows: nurseRows } = await query<{ id: string; display_name: string; email: string }>(
    `SELECT id, display_name, email FROM users WHERE id = $1 AND organisation_id = $2 AND role = 'learner'`,
    [uuidOr404(nurseId), hospital.id],
  );
  const nurse = nurseRows[0];
  if (!nurse) throw notFound();
  const course = await findCourse(pack.course_id);
  if (!course) throw notFound();

  if (course.state !== "published") throw err(409, "course_not_open");
  if (pack.expired || Date.now() >= new Date(pack.expires_at).getTime()) throw err(409, "pack_expired");
  const { rows: existing } = await query<{ id: string }>(
    `SELECT id FROM enrolments WHERE nurse_id = $1 AND course_id = $2 AND state IN ('held','confirmed','completed','certified')`,
    [nurse.id, course.id],
  );
  if (existing.length > 0) throw err(409, "already_enrolled");
  if (pack.balance <= 0) throw err(409, "pack_empty");
  if (Object.keys(errors).length > 0) throw validationError(errors);

  const result = await withSerializable(async (client) => {
    const fresh = await client.query<{ id: string; expires_at: Date; expired: boolean }>(
      `SELECT id, expires_at, expired FROM packs WHERE id = $1 FOR UPDATE`,
      [pack.id],
    );
    const packRow = fresh.rows[0];
    if (!packRow) throw notFound();
    await expirePackIfDue(client, { id: packRow.id, expires_at: new Date(packRow.expires_at), expired: packRow.expired });
    const expiredNow = await client.query<{ expired: boolean }>(`SELECT expired FROM packs WHERE id = $1`, [pack.id]);
    if (expiredNow.rows[0]?.expired) throw err(409, "pack_expired");
    const balance = await packBalance(client, pack.id);
    if (balance <= 0) throw err(409, "pack_empty");

    const assignmentId = randomUUID();
    const enrolmentId = randomUUID();
    await client.query(
      `INSERT INTO enrolments (id, nurse_id, course_id, cohort_id, state, funding, assignment_id, hospital_id, list_price_cents, employer_share_cents, learner_share_cents, enrolled_at, paid_at)
       VALUES ($1, $2, $3, NULL, 'confirmed', 'seat', $4, $5, $6, 0, 0, now(), now())`,
      [enrolmentId, nurse.id, course.id, assignmentId, hospital.id, course.list_price_cents],
    );
    await postMovement(client, pack.id, "assignment", [
      { account: "pack", seats: -1 },
      { account: `nurse:${nurse.id}`, seats: 1 },
    ], assignmentId);
    await client.query(
      `INSERT INTO seat_assignments (id, pack_id, nurse_id, enrolment_id, state) VALUES ($1, $2, $3, $4, 'assigned')`,
      [assignmentId, pack.id, nurse.id, enrolmentId],
    );
    return { assignmentId, enrolmentId };
  });

  await withTransaction(async (client) => {
    await client.query(`INSERT INTO email_outbox (id, to_email, subject, body) VALUES (gen_random_uuid(), $1, $2, $3)`, [
      nurse.email,
      `Your Credwell seat: ${course.title}`,
      [
        `${nurse.display_name},`,
        ``,
        `${hospital.name} has assigned you a prepaid seat for "${course.title}".`,
        `Open the course: ${ctx.origin}/courses/${course.id}`,
      ].join("\n"),
    ]);
  });

  const enrolment = await loadEnrolment(result.enrolmentId);
  if (!enrolment) throw new Error("enrolment missing after assignment");
  ctx.res.status(201).json({
    assignment: { id: result.assignmentId, pack_id: pack.id, nurse_id: nurse.id, enrolment_id: result.enrolmentId, state: "assigned" },
    enrolment: serialiseEnrolment(enrolment, await enrolmentModules(result.enrolmentId)),
  });
}

export async function returnSeat(ctx: Ctx): Promise<void> {
  const hospital = await myHospital(ctx);
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  if (body !== null && typeof body === "object" && Object.keys(body).length > 0) {
    const errors: Record<string, string> = {};
    for (const key of Object.keys(body)) errors[key] = "This field is not accepted.";
    throw validationError(errors);
  }
  const { rows } = await query<{ id: string; pack_id: string; nurse_id: string; enrolment_id: string; state: string }>(
    `SELECT a.id, a.pack_id, a.nurse_id, a.enrolment_id, a.state
       FROM seat_assignments a JOIN packs p ON p.id = a.pack_id
      WHERE a.id = $1 AND p.hospital_id = $2`,
    [uuidOr404(pathParam(ctx, "id")), hospital.id],
  );
  const assignment = rows[0];
  if (!assignment) throw notFound();

  const enrolment = await loadEnrolment(assignment.enrolment_id);
  if (!enrolment) throw notFound();

  if (assignment.state === "returned") throw err(409, "already_returned");
  if (!(enrolment.state === "confirmed" && enrolment.verified_minutes === 0)) throw err(409, "seat_in_use");

  await withSerializable(async (client) => {
    await client.query(
      `UPDATE enrolments SET state = 'withdrawn' WHERE id = $1 AND state = 'confirmed'`,
      [assignment.enrolment_id],
    );
    await postMovement(client, assignment.pack_id, "return", [
      { account: "pack", seats: 1 },
      { account: `nurse:${assignment.nurse_id}`, seats: -1 },
    ], assignment.id);
    await client.query(`UPDATE seat_assignments SET state = 'returned' WHERE id = $1`, [assignment.id]);
  });

  const fresh = await loadEnrolment(assignment.enrolment_id);
  if (!fresh) throw notFound();
  ctx.res.json({
    assignment: { id: assignment.id, pack_id: assignment.pack_id, nurse_id: assignment.nurse_id, enrolment_id: assignment.enrolment_id, state: "returned" },
    enrolment: serialiseEnrolment(fresh, await enrolmentModules(assignment.enrolment_id)),
  });
}

export async function searchLearners(ctx: Ctx): Promise<void> {
  const hospital = await myHospital(ctx);
  const q = ctx.query.get("q") ?? "";
  if (q.length > 100) throw validationError({ q: "Search with at most 100 characters." });
  const like = `%${escapeLike(q)}%`;
  const { rows } = await query<{ id: string }>(
    `SELECT u.id FROM users u
      WHERE u.organisation_id = $1 AND u.role = 'learner'
        AND ($2 = '' OR u.display_name ILIKE $3 OR u.email ILIKE $3)
      ORDER BY u.display_name`,
    [hospital.id, q, like],
  );
  const list = [];
  for (const r of rows) {
    const learner = await learnerSummary(r.id, hospital.id);
    if (learner) list.push(learner);
  }
  ctx.res.json({ learners: list });
}

function escapeLike(text: string): string {
  return text.replace(/([%_\\])/g, "\\$1");
}

async function learnerSummary(nurseId: string, hospitalId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await query<{ display_name: string; email: string; seats_held: string; hours: string }>(
    `SELECT u.display_name, u.email,
            COALESCE((SELECT sum(e.seats) FROM ledger_entries e JOIN packs p ON p.id = e.pack_id
                       WHERE e.account = 'nurse:' || $2::text AND p.hospital_id = $1), 0)::text AS seats_held,
            COALESCE((SELECT sum(c.contact_hours_h) FROM certificates c JOIN enrolments e2 ON e2.id = c.enrolment_id
                       WHERE c.state = 'sealed' AND e2.nurse_id = $2::uuid AND e2.hospital_id = $1
                         AND e2.funding IN ('seat','co_pay')), 0)::text AS hours
       FROM users u WHERE u.id = $2::uuid`,
    [hospitalId, nurseId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: nurseId,
    display_name: row.display_name,
    email: row.email,
    seats_held: Number(row.seats_held),
    hours_completed: ((Number(row.hours)) / 100).toFixed(2),
  };
}

export async function learnerRecord(ctx: Ctx): Promise<void> {
  const hospital = await myHospital(ctx);
  const { rows } = await query<{ id: string; display_name: string; email: string }>(
    `SELECT id, display_name, email FROM users WHERE id = $1 AND organisation_id = $2 AND role = 'learner'`,
    [uuidOr404(pathParam(ctx, "id")), hospital.id],
  );
  const nurse = rows[0];
  if (!nurse) throw notFound();
  const { rows: enrolmentRows } = await query<{ id: string }>(
    `SELECT e.id FROM enrolments e WHERE e.nurse_id = $1 AND e.hospital_id = $2 AND e.funding IN ('seat','co_pay')`,
    [nurse.id, hospital.id],
  );
  if (enrolmentRows.length === 0) throw notFound();
  const enrolments = [];
  for (const r of enrolmentRows) {
    const e = await loadEnrolment(r.id);
    if (e) enrolments.push(serialiseEnrolment(e, await enrolmentModules(r.id)));
  }
  const certificates = [];
  const { rows: certRows } = await query<{ id: string }>(
    `SELECT c.id FROM certificates c JOIN enrolments e ON e.id = c.enrolment_id
      WHERE e.nurse_id = $1 AND e.hospital_id = $2 AND e.funding IN ('seat','co_pay')`,
    [nurse.id, hospital.id],
  );
  for (const r of certRows) {
    const cert = await loadCertificate(r.id);
    if (cert) certificates.push(serialiseCertificateDto(cert));
  }
  ctx.res.json({ learner: { id: nurse.id, display_name: nurse.display_name, email: nurse.email }, enrolments, certificates });
}

export async function monthlyReport(ctx: Ctx): Promise<void> {
  const hospital = await myHospital(ctx);
  const yearText = ctx.query.get("year") ?? "";
  if (!/^\d{4}$/.test(yearText) || Number(yearText) < 2000 || Number(yearText) > 2100) {
    throw validationError({ year: "Choose a year from 2000 to 2100." });
  }
  const { rows } = await query<{ month: string; completions: string; hours: string }>(
    `SELECT to_char(c.issued_on, 'YYYY-MM') AS month, count(*)::text AS completions,
            COALESCE(sum(c.contact_hours_h),0)::text AS hours
       FROM certificates c JOIN enrolments e ON e.id = c.enrolment_id
      WHERE c.state = 'sealed' AND c.issued_on IS NOT NULL AND to_char(c.issued_on,'YYYY') = $1
        AND e.hospital_id = $2 AND e.funding IN ('seat','co_pay')
      GROUP BY to_char(c.issued_on, 'YYYY-MM')`,
    [yearText, hospital.id],
  );
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    const key = `${yearText}-${String(m).padStart(2, "0")}`;
    const row = byMonth.get(key);
    months.push({
      month: key,
      completions: Number(row?.completions ?? 0),
      hours: ((Number(row?.hours ?? 0)) / 100).toFixed(2),
    });
  }
  ctx.res.json({ year: yearText, months });
}

export async function createExport(ctx: Ctx): Promise<void> {
  const hospital = await myHospital(ctx);
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (key !== "from" && key !== "to") errors[key] = "This field is not accepted.";
  }
  const from = body.from;
  const to = body.to;
  if (typeof from !== "string" || !isIsoDate(from)) errors.from = "Enter a start date as YYYY-MM-DD.";
  if (typeof to !== "string" || !isIsoDate(to)) errors.to = "Enter an end date as YYYY-MM-DD.";
  if (typeof from === "string" && isIsoDate(from) && typeof to === "string" && isIsoDate(to)) {
    if (from > to) errors.to = "The end date must be on or after the start date.";
    else if (dayCount(from, to) > 366) errors.to = "Export at most 366 days at a time.";
  }
  if (Object.keys(errors).length > 0) throw validationError(errors);

  const { rows } = await query<{
    nurse_name: string;
    nurse_email: string;
    course_title: string;
    serial: string;
    issued_on: string;
    contact_hours_h: number;
    funding: string;
  }>(
    `SELECT vn.nurse_name, u.email AS nurse_email, co.title AS course_title, c.serial,
            to_char(c.issued_on,'YYYY-MM-DD') AS issued_on, c.contact_hours_h, e.funding
       FROM certificates c
       JOIN enrolments e ON e.id = c.enrolment_id
       JOIN courses co ON co.id = e.course_id
       JOIN users u ON u.id = e.nurse_id
       JOIN certificate_versions vn ON vn.certificate_id = c.id AND vn.version = c.current_version
      WHERE c.state = 'sealed' AND c.issued_on BETWEEN $1 AND $2
        AND e.hospital_id = $3 AND e.funding IN ('seat','co_pay')
      ORDER BY c.issued_on, c.serial`,
    [from, to, hospital.id],
  );

  const lines = ["nurse_name,nurse_email,course_title,serial,issued_on,contact_hours,funding"];
  for (const r of rows) {
    const cells = [
      r.nurse_name,
      r.nurse_email,
      r.course_title,
      r.serial,
      r.issued_on,
      (r.contact_hours_h / 100).toFixed(2),
      r.funding,
    ].map((cell) => csvCell(cell));
    lines.push(cells.join(","));
  }
  const csv = `${lines.join("\n")}\n`;
  const exportId = randomUUID();
  try {
    await putObject(`exports/${hospital.slug}/${exportId}.csv`, Buffer.from(csv, "utf8"), "text/csv");
  } catch {
    throw err(503, "storage_unavailable");
  }
  await query(`INSERT INTO export_records (id, hospital_id, row_count, from_date, to_date) VALUES ($1, $2, $3, $4, $5)`, [
    exportId,
    hospital.id,
    rows.length,
    from,
    to,
  ]);
  ctx.res.status(201).json({
    export: { id: exportId, rows: rows.length, download_url: `/api/sponsor/exports/${exportId}.csv` },
  });
}

function dayCount(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
}

export function csvCell(raw: string): string {
  let cell = raw;
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  if (/[,"]/.test(cell)) cell = `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

export async function downloadExport(ctx: Ctx): Promise<void> {
  const hospital = await myHospital(ctx);
  const exportId = uuidOr404(pathParam(ctx, "id"));
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM export_records WHERE id = $1 AND hospital_id = $2`,
    [exportId, hospital.id],
  );
  if (rows.length === 0) throw notFound();
  let bytes: Buffer;
  try {
    bytes = await getObject(`exports/${hospital.slug}/${exportId}.csv`);
  } catch {
    throw err(503, "storage_unavailable");
  }
  ctx.res.set("Content-Type", "text/csv; charset=utf-8");
  ctx.res.send(bytes);
}
