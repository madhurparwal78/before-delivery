import { randomUUID } from "node:crypto";
import { isTrade, type AccessCard, type Role, type Visit } from "../../shared/domain";
import { hashPassword } from "../auth";
import { isUuid, jobAccess, lockOpenJob, requireOpenJob, requireRole, type JobAccess } from "../access";
import { maybeOne, one, pool, rows, transaction, type Tx } from "../db";
import { fail, invalid } from "../errors";
import { emit } from "../events";
import { json, noContent, readJson, route } from "../http";
import { loadOutbox } from "../mail";
import { projectMember, type MemberRow } from "../projection";
import { formatUtc } from "../schedule";
import { codesVisibleUntil, loadSeries, occurrencesOf, planOccurrences, projectVisit, refuseOverlap } from "../visits";

const NAME_MAX = 120;
const EMAIL_MAX = 254;
const PHONE_MAX = 40;
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;
const CODE_MAX = 40;
const HOUSE_NOTE_MAX = 500;
const MEMBER_ROLES = ["lead", "trade", "homeowner"] as const;

const MEMBER_COLUMNS = "m.id, m.person_id, p.name, m.role, m.trade, p.email, p.phone";

route("GET", "/api/jobs/:jobId/members", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const members = await rows<MemberRow>(
    pool,
    `SELECT ${MEMBER_COLUMNS} FROM job_members m JOIN people p ON p.id = m.person_id
     WHERE m.job_id = $1 AND m.ended_at IS NULL ORDER BY m.role = 'owner' DESC, m.position`,
    [access.job.id],
  );
  return json(200, { members: members.map((member) => projectMember(access, member)) });
});

route("POST", "/api/jobs/:jobId/members", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  requireRole(access, "owner");
  requireOpenJob(access);
  const body = readJson(call);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const account = email ? await maybeOne<{ id: string }>(pool, "SELECT id FROM people WHERE email = $1", [email]) : null;
  if (account) {
    const held = await maybeOne(pool, "SELECT 1 FROM job_members WHERE job_id = $1 AND person_id = $2 AND ended_at IS NULL", [
      access.job.id,
      account.id,
    ]);
    if (held) fail("already_member");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" && body.phone.trim() !== "" ? body.phone.trim() : null;
  const role = body.role as (typeof MEMBER_ROLES)[number];
  const errors: Record<string, string> = {};
  if (!account && (name.length < 1 || name.length > NAME_MAX)) errors.name = `Enter a name of 1 to ${NAME_MAX} characters.`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > EMAIL_MAX) errors.email = "Enter an email address like name@example.com.";
  if (phone !== null && phone.length > PHONE_MAX) errors.phone = `Keep the phone number to ${PHONE_MAX} characters.`;
  if (!MEMBER_ROLES.includes(role)) errors.role = "Choose lead carpenter, trade or homeowner.";
  if (role === "trade" && !isTrade(body.trade)) errors.trade = "Choose the trade this person works in.";
  if (role !== "trade" && body.trade !== null && body.trade !== undefined) errors.trade = "Only a trade has a trade.";
  const password = typeof body.initial_password === "string" ? body.initial_password : "";
  if (!account && (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)) {
    errors.initial_password = `Give an initial password of ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`;
  }
  if (Object.keys(errors).length > 0) invalid(errors);
  const memberId = randomUUID();
  await transaction(async (tx) => {
    await lockOpenJob(tx, access.job.id);
    let personId = account?.id;
    if (!personId) {
      personId = randomUUID();
      await tx.query("INSERT INTO people (id, firm_id, name, email, phone, password_hash) VALUES ($1, $2, $3, $4, $5, $6)", [
        personId,
        access.job.firm_id,
        name,
        email,
        phone,
        await hashPassword(password),
      ]);
    } else if (phone !== null) {
      await tx.query("UPDATE people SET phone = $2 WHERE id = $1", [personId, phone]);
    }
    await tx.query("INSERT INTO job_members (id, job_id, person_id, role, trade) VALUES ($1, $2, $3, $4, $5)", [
      memberId,
      access.job.id,
      personId,
      role,
      role === "trade" ? body.trade : null,
    ]);
  }).catch((error: unknown) => {
    if ((error as { code?: string }).code === "23505") fail("already_member");
    throw error;
  });
  const member = await one<MemberRow>(pool, `SELECT ${MEMBER_COLUMNS} FROM job_members m JOIN people p ON p.id = m.person_id WHERE m.id = $1`, [
    memberId,
  ]);
  return json(201, projectMember(access, member));
});

route("DELETE", "/api/jobs/:jobId/members/:memberId", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const memberId = call.params.memberId;
  const member = isUuid(memberId)
    ? await maybeOne<{ id: string; role: Role }>(pool, "SELECT id, role FROM job_members WHERE id = $1 AND job_id = $2 AND ended_at IS NULL", [
        memberId,
        access.job.id,
      ])
    : null;
  if (!member) fail("not_found");
  requireRole(access, "owner");
  requireOpenJob(access);
  if (member.role === "owner") fail("invalid_transition");
  await transaction(async (tx) => {
    await lockOpenJob(tx, access.job.id);
    await tx.query("UPDATE job_members SET ended_at = clock_timestamp() WHERE id = $1", [member.id]);
    const removed = await rows<{ id: string }>(tx, "DELETE FROM visit_series WHERE member_id = $1 RETURNING id", [member.id]);
    for (const visit of removed) emit(tx, access.job.id, { type: "visit_deleted", id: visit.id, memberId: member.id });
    emit(tx, access.job.id, { type: "role_ended", memberId: member.id });
  });
  return noContent();
});

route("GET", "/api/jobs/:jobId/visits", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  requireRole(access, "owner", "lead", "trade");
  const series = await loadSeries(pool, access.job.id, access.role === "trade" ? access.memberId : null);
  const now = new Date();
  return json(200, { visits: series.map((one) => projectVisit(one, access.job.time_zone, now)) });
});

/** The visit series as stored and projected, announced to the crew and that trade. */
async function emitVisit(tx: Tx, access: JobAccess, visitId: string): Promise<Visit> {
  const series = (await loadSeries(tx, access.job.id)).find((candidate) => candidate.id === visitId)!;
  const visit = projectVisit(series, access.job.time_zone, new Date());
  emit(tx, access.job.id, { type: "visit", visit, memberId: series.member_id });
  emit(tx, access.job.id, { type: "job" });
  return visit;
}

route("POST", "/api/jobs/:jobId/visits", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const body = readJson(call);
  const member = isUuid(body.member_id)
    ? await maybeOne<{ id: string; role: Role }>(pool, "SELECT id, role FROM job_members WHERE id = $1 AND job_id = $2 AND ended_at IS NULL", [
        body.member_id,
        access.job.id,
      ])
    : null;
  if (body.member_id !== undefined && body.member_id !== null && !member) fail("not_found");
  requireRole(access, "owner", "lead");
  const id = randomUUID();
  await transaction(async (tx) => {
    await lockOpenJob(tx, access.job.id);
    // One booking at a time per person, so of two overlapping requests exactly one succeeds.
    if (member) await tx.query("SELECT 1 FROM job_members WHERE id = $1 FOR UPDATE", [member.id]);
    const plan = planOccurrences(access.job.time_zone, body.starts_at, body.ends_at, body.recurrence);
    if (member) await refuseOverlap(tx, access.job.id, access.job.time_zone, member.id, plan.candidates, null);
    const errors = { ...plan.errors };
    if (!member) errors.member_id = "Choose the trade who is visiting.";
    else if (member.role !== "trade") errors.member_id = "Site visits are for trades.";
    if (Object.keys(errors).length > 0) invalid(errors);
    await tx.query(
      "INSERT INTO visit_series (id, job_id, member_id, starts_local, ends_local, recurrence, dates) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)",
      [id, access.job.id, member!.id, plan.startsLocal, plan.endsLocal, JSON.stringify(plan.rule), JSON.stringify(plan.dates)],
    );
    await emitVisit(tx, access, id);
  });
  const series = (await loadSeries(pool, access.job.id)).find((candidate) => candidate.id === id)!;
  return json(201, projectVisit(series, access.job.time_zone, new Date()));
});

/** The series and one of its generated occurrences, locked, for a move or a cancel. */
async function occurrenceFor(tx: Tx, access: JobAccess, visitId: unknown, date: string) {
  const series = isUuid(visitId)
    ? (await loadSeries(tx, access.job.id)).find((candidate) => candidate.id === visitId) ?? null
    : null;
  const occurrence = series ? occurrencesOf(series, access.job.time_zone).find((candidate) => candidate.date === date) : undefined;
  if (!series || !occurrence || occurrence.status === "cancelled") fail("not_found");
  requireRole(access, "owner", "lead");
  await lockOpenJob(tx, access.job.id);
  await tx.query("SELECT 1 FROM job_members WHERE id = $1 FOR UPDATE", [series.member_id]);
  if (occurrence.endsUtc !== null && occurrence.endsUtc.getTime() <= Date.now()) fail("invalid_transition");
  return { series, occurrence };
}

route("PUT", "/api/jobs/:jobId/visits/:visitId/occurrences/:date", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const body = readJson(call);
  const visit = await transaction(async (tx) => {
    const { series, occurrence } = await occurrenceFor(tx, access, call.params.visitId, call.params.date!);
    const plan = planOccurrences(access.job.time_zone, body.starts_at, body.ends_at, null);
    await refuseOverlap(tx, access.job.id, access.job.time_zone, series.member_id, plan.candidates, { visitId: series.id, date: occurrence.date });
    if (Object.keys(plan.errors).length > 0) invalid(plan.errors);
    await tx.query(
      `INSERT INTO visit_exceptions (visit_id, date, status, starts_local, ends_local) VALUES ($1, $2, 'moved', $3, $4)
       ON CONFLICT (visit_id, date) DO UPDATE SET status = 'moved', starts_local = EXCLUDED.starts_local, ends_local = EXCLUDED.ends_local`,
      [series.id, occurrence.date, plan.startsLocal, plan.endsLocal],
    );
    return emitVisit(tx, access, series.id);
  });
  return json(200, visit);
});

route("DELETE", "/api/jobs/:jobId/visits/:visitId/occurrences/:date", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const visit = await transaction(async (tx) => {
    const { series, occurrence } = await occurrenceFor(tx, access, call.params.visitId, call.params.date!);
    await tx.query(
      `INSERT INTO visit_exceptions (visit_id, date, status) VALUES ($1, $2, 'cancelled')
       ON CONFLICT (visit_id, date) DO UPDATE SET status = 'cancelled', starts_local = NULL, ends_local = NULL`,
      [series.id, occurrence.date],
    );
    return emitVisit(tx, access, series.id);
  });
  return json(200, visit);
});

route("DELETE", "/api/jobs/:jobId/visits/:visitId", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const visitId = call.params.visitId;
  const visit = isUuid(visitId)
    ? await maybeOne<{ member_id: string }>(pool, "SELECT member_id FROM visit_series WHERE id = $1 AND job_id = $2", [visitId, access.job.id])
    : null;
  if (!visit) fail("not_found");
  requireRole(access, "owner", "lead");
  await transaction(async (tx) => {
    await lockOpenJob(tx, access.job.id);
    await tx.query("DELETE FROM visit_series WHERE id = $1", [visitId]);
    emit(tx, access.job.id, { type: "visit_deleted", id: visitId!, memberId: visit.member_id });
    emit(tx, access.job.id, { type: "job" });
  });
  return noContent();
});

interface CardRow {
  lockbox_code: string;
  alarm_code: string;
  garage_code: string;
  house_note: string;
}

const CARD_COLUMNS = "lockbox_code, alarm_code, garage_code, house_note";

route("GET", "/api/jobs/:jobId/access", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  requireRole(access, "owner", "lead", "trade");
  let visibleUntil: Date | null = null;
  if (access.role === "trade") {
    visibleUntil = codesVisibleUntil(await loadSeries(pool, access.job.id, access.memberId), access.job.time_zone, new Date());
    if (!visibleUntil) fail("outside_site_visit");
  }
  const card = await transaction(async (tx) => {
    await tx.query("INSERT INTO code_reveals (job_id, person_id, role) VALUES ($1, $2, $3)", [access.job.id, access.person.id, access.role]);
    return one<CardRow>(tx, `SELECT ${CARD_COLUMNS} FROM access_cards WHERE job_id = $1`, [access.job.id]);
  });
  const body: AccessCard = { ...card, visible_until: visibleUntil ? formatUtc(visibleUntil) : null };
  return json(200, body);
});

route("PUT", "/api/jobs/:jobId/access", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  requireRole(access, "owner");
  requireOpenJob(access);
  const body = readJson(call);
  const errors: Record<string, string> = {};
  const card: CardRow = { lockbox_code: "", alarm_code: "", garage_code: "", house_note: "" };
  for (const field of ["lockbox_code", "alarm_code", "garage_code"] as const) {
    const value = body[field] ?? "";
    if (typeof value !== "string" || value.length > CODE_MAX) errors[field] = `Keep codes to ${CODE_MAX} characters.`;
    else card[field] = value;
  }
  const note = body.house_note ?? "";
  if (typeof note !== "string" || note.length > HOUSE_NOTE_MAX) errors.house_note = `Keep the house note to ${HOUSE_NOTE_MAX} characters.`;
  else card.house_note = note;
  if (Object.keys(errors).length > 0) invalid(errors);
  const saved = await one<CardRow>(
    pool,
    `INSERT INTO access_cards (job_id, ${CARD_COLUMNS}) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (job_id) DO UPDATE SET lockbox_code = EXCLUDED.lockbox_code, alarm_code = EXCLUDED.alarm_code,
       garage_code = EXCLUDED.garage_code, house_note = EXCLUDED.house_note
     RETURNING ${CARD_COLUMNS}`,
    [access.job.id, card.lockbox_code, card.alarm_code, card.garage_code, card.house_note],
  );
  const response: AccessCard = { ...saved, visible_until: null };
  return json(200, response);
});

route("GET", "/api/jobs/:jobId/access/reveals", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  requireRole(access, "owner");
  const reveals = await rows<{ name: string; role: Role; revealed_at: string }>(
    pool,
    `SELECT p.name, r.role, r.revealed_at FROM code_reveals r JOIN people p ON p.id = r.person_id
     WHERE r.job_id = $1 ORDER BY r.revealed_at DESC, r.id DESC`,
    [access.job.id],
  );
  return json(200, { reveals });
});

route("GET", "/api/jobs/:jobId/outbox", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  requireRole(access, "owner");
  const entries = await loadOutbox(pool, access.job.id);
  return json(200, {
    entries: entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      to: entry.to_email,
      subject: entry.subject,
      status: entry.status,
      created_at: entry.created_at,
      sent_at: entry.sent_at,
    })),
  });
});

