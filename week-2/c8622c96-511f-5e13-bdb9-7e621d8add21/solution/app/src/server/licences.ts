// Licences: requests (serialised per essay by the essay row lock and guarded by partial unique indexes),
// idempotent replay, listings, and short-lived original grants.
import { randomBytes } from "node:crypto";
import { coopTime, holdDeadline, isoInstant, windowEnd } from "../shared/coop-time.js";
import { attemptActivation } from "./activation.js";
import { newsroomOf, requireRole, type Person } from "./auth.js";
import { serverNow } from "./clock.js";
import { isUniqueViolation, one, query, transaction, type Client } from "./db.js";
import { creditLine, loadEssay, visibleEssay, windowBody, type EssayRow } from "./essay-model.js";
import { ApiError, errorBody, notFound, sendError, sendJson, takenDown } from "./http.js";
import { isStanding, licenceState, type LicenceKind, type LicenceRow, type LicenceState } from "./licence-state.js";
import { isOnSheet } from "./lifecycle.js";
import { receiptState } from "./mail.js";
import { rateAt } from "./rates.js";
import { on, type Ctx } from "./router.js";
import { keys, objectExists, presignGet } from "./s3.js";
import { strictBody, WRONG_TYPE } from "./strict-body.js";

const KEY_MESSAGE = "Send an Idempotency-Key header of 1 to 100 visible characters";
const KIND_MESSAGE = "Kind must be exclusive or standard";
const PLACEHOLDER_TITLE = "Removed essay (legal takedown)";
const GRANT_MAX_SECONDS = 300;

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function licenceId(): string {
  return `lic-${[...randomBytes(14)].map((b) => ALPHABET[b % ALPHABET.length]).join("")}`;
}

export interface Listed {
  row: LicenceRow;
  state: LicenceState;
}

/** A newsroom's licences that still exist, in their state at `now`, newest confirmation first. */
export async function newsroomLicences(newsroom: string, now: Date, client?: Client): Promise<Listed[]> {
  const rows = await query<LicenceRow>(
    "SELECT * FROM licences WHERE newsroom = $1 AND status <> 'removed' ORDER BY confirmed_at DESC, id", [newsroom], client);
  return rows.flatMap((row) => {
    const state = licenceState(row, now);
    return state ? [{ row, state }] : [];
  });
}

interface LicenceContext {
  essays: Map<string, EssayRow & { credit_line: string }>;
  frames: Map<string, { id: string; position: number }[]>;
  people: Map<string, string>;
  rooms: Map<string, string>;
  receipts: Map<string, string[]>;
}

async function contextFor(listed: Listed[], client?: Client): Promise<LicenceContext> {
  const essayIds = [...new Set(listed.map((l) => l.row.essay_id))];
  const licenceIds = listed.map((l) => l.row.id);
  const [essays, credits, frames, people, rooms, mails] = await Promise.all([
    query<EssayRow>("SELECT * FROM essays WHERE id = ANY($1)", [essayIds], client),
    query<{ essay_id: string; name: string }>(
      "SELECT c.essay_id, p.name FROM credits c JOIN people p ON p.handle = c.handle WHERE c.essay_id = ANY($1) ORDER BY c.position",
      [essayIds], client),
    query<{ id: string; essay_id: string; position: number }>(
      "SELECT id, essay_id, position FROM frames WHERE essay_id = ANY($1) ORDER BY position", [essayIds], client),
    query<{ id: string; name: string }>("SELECT id, name FROM people WHERE id = ANY($1)",
      [[...new Set(listed.map((l) => l.row.licensed_by))]], client),
    query<{ slug: string; name: string }>("SELECT slug, name FROM newsrooms", [], client),
    query<{ licence_id: string; state: string }>(
      "SELECT licence_id, state FROM mail_queue WHERE kind = 'receipt' AND licence_id = ANY($1)", [licenceIds], client),
  ]);
  const context: LicenceContext = {
    essays: new Map(), frames: new Map(), people: new Map(people.map((p) => [p.id, p.name])),
    rooms: new Map(rooms.map((r) => [r.slug, r.name])), receipts: new Map(),
  };
  for (const essay of essays) {
    context.essays.set(essay.id, {
      ...essay, credit_line: creditLine(credits.filter((c) => c.essay_id === essay.id).map((c) => c.name)),
    });
    context.frames.set(essay.id, frames.filter((f) => f.essay_id === essay.id).map((f) => ({ id: f.id, position: f.position })));
  }
  for (const mail of mails) context.receipts.set(mail.licence_id, [...(context.receipts.get(mail.licence_id) ?? []), mail.state]);
  return context;
}

function licenceBody(item: Listed, context: LicenceContext): Record<string, unknown> {
  const { row, state } = item;
  const essay = context.essays.get(row.essay_id);
  const revoked = state === "revoked";
  const pending = state === "pending_invoice";
  return {
    id: row.id,
    essay_id: row.essay_id,
    essay_title: revoked ? PLACEHOLDER_TITLE : essay?.title ?? "",
    credit_line: revoked ? null : essay?.credit_line ?? null,
    kind: row.kind,
    state,
    newsroom: { slug: row.newsroom, name: context.rooms.get(row.newsroom) ?? row.newsroom },
    licensed_by: { name: context.people.get(row.licensed_by) ?? "" },
    confirmed_at: isoInstant(row.confirmed_at),
    confirmed_display: coopTime(row.confirmed_at),
    window_start: isoInstant(row.confirmed_at),
    window_end: isoInstant(row.window_end),
    window_end_display: coopTime(row.window_end),
    hold_until: pending ? isoInstant(row.hold_until) : null,
    hold_until_display: pending ? coopTime(row.hold_until) : null,
    amount_minor: row.amount_minor,
    currency: "USD",
    invoice_state: row.invoice_raised ? "raised" : "pending",
    receipt_state: receiptState(context.receipts.get(row.id) ?? []),
    frames: revoked ? [] : context.frames.get(row.essay_id) ?? [],
  };
}

export async function licenceBodies(listed: Listed[], client?: Client): Promise<Record<string, unknown>[]> {
  const context = await contextFor(listed, client);
  return listed.map((item) => licenceBody(item, context));
}

/** The essay caption for CSV rows, keyed by essay id. */
export async function essayCaptions(listed: Listed[]): Promise<Map<string, string>> {
  const rows = await query<{ id: string; caption: string }>("SELECT id, caption FROM essays WHERE id = ANY($1)",
    [[...new Set(listed.map((l) => l.row.essay_id))]]);
  return new Map(rows.map((e) => [e.id, e.caption]));
}

/** One of the caller's newsroom's licences, or 404 (unknown, removed or another newsroom's). */
async function ownLicence(person: Person, id: string, now: Date): Promise<Listed> {
  requireRole(person, "picture_editor", "licensing_manager");
  const row = await one<LicenceRow>("SELECT * FROM licences WHERE id = $1", [id]);
  const state = row ? licenceState(row, now) : null;
  if (!row || !state || row.newsroom !== newsroomOf(person).slug) throw notFound();
  return { row, state };
}

on("GET", "/api/licences", "none", async (ctx: Ctx) => {
  requireRole(ctx.person, "picture_editor", "licensing_manager");
  const now = await serverNow();
  const listed = await newsroomLicences(newsroomOf(ctx.person).slug, now);
  sendJson(ctx.res, 200, { licences: await licenceBodies(listed) });
});

on("GET", "/api/licences/:id", "none", async (ctx: Ctx) => {
  const now = await serverNow();
  const found = await ownLicence(ctx.person, ctx.params[0] ?? "", now);
  sendJson(ctx.res, 200, (await licenceBodies([found]))[0]);
});

// --- Licence requests -------------------------------------------------------------------------------

/** Decides and records one licence request on a locked essay. Throws the conflict that refuses it. */
async function confirmLicence(client: Client, person: Person, essayId: string, kind: LicenceKind): Promise<LicenceRow> {
  const essay = await loadEssay(essayId, client, true);
  if (!essay) throw notFound();
  if (essay.state === "taken_down") throw takenDown();
  if (!isOnSheet(essay.state)) throw new ApiError(409, "not_licensable", "This essay can't be licensed right now.");
  const now = await serverNow(client);
  const room = newsroomOf(person).slug;
  const rows = await query<LicenceRow>(
    "SELECT * FROM licences WHERE essay_id = $1 AND status IN ('pending', 'active')", [essayId], client);
  for (const row of rows.filter((r) => !isStanding(r, now))) {
    await query("UPDATE licences SET status = $2 WHERE id = $1", [row.id, row.status === "active" ? "expired" : "removed"], client);
  }
  const window = windowBody(person, rows, now);
  if (kind === "exclusive") {
    if (window.state === "claimed") {
      throw new ApiError(409, "window_held", "The exclusive window is already held.",
        { held_by: window.held_by, held_until: window.held_until });
    }
    if (window.standard_running_until) {
      throw new ApiError(409, "standard_licences_active", "Standard licences are running on this essay.",
        { blocked_until: window.standard_running_until });
    }
  } else if (window.held_by === "another_newsroom") {
    throw new ApiError(409, "exclusive_held", "Another newsroom holds the exclusive window.",
      { held_by: window.held_by, held_until: window.held_until });
  }
  if (rows.some((r) => r.newsroom === room && isStanding(r, now))) {
    throw new ApiError(409, "already_licensed", "Your newsroom already licenses this essay.");
  }
  const end = windowEnd(now, essay.lift_at, kind === "exclusive" ? essay.exclusive_days : essay.standard_days);
  const [row] = await query<LicenceRow>(
    `INSERT INTO licences (id, essay_id, newsroom, licensed_by, kind, status, confirmed_at, window_end, hold_until,
       amount_minor, rate_bp, attempts)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10, 1) RETURNING *`,
    [licenceId(), essayId, room, person.id, kind, now, end, holdDeadline(now, end),
      kind === "exclusive" ? essay.exclusive_price_minor : essay.standard_price_minor, await rateAt(client, now)],
    client);
  return row as LicenceRow;
}

/**
 * Confirms a licence and makes its first activation attempt in the same commit, so the essay lock is held
 * until the outcome is settled: rivals see it active or pending, and a billing refusal leaves no licence.
 */
async function requestLicence(person: Person, essayId: string, kind: LicenceKind): Promise<{ status: number; body: unknown }> {
  let row: LicenceRow;
  try {
    row = await transaction(async (client) => {
      const confirmed = await confirmLicence(client, person, essayId, kind);
      const attempt = await attemptActivation(client, confirmed);
      if (attempt === "refused") {
        throw new ApiError(502, "billing_rejected", "Billing refused the invoice; nothing was licensed.");
      }
      return await one<LicenceRow>("SELECT * FROM licences WHERE id = $1", [confirmed.id], client) as LicenceRow;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    throw new ApiError(409, "already_licensed", "Your newsroom already licenses this essay.");
  }
  const state = row.status === "active" ? "active" : "pending_invoice";
  const [body] = await licenceBodies([{ row, state }]);
  return { status: state === "active" ? 201 : 202, body };
}

type KeySlot = { fresh: true } | { fresh: false; status: number; body: unknown };

/** Claims an idempotency key for this person, or returns the stored response once the first request finishes. */
async function claimKey(person: Person, key: string, essayId: string, kind: string): Promise<KeySlot> {
  const inserted = await query(
    `INSERT INTO idempotency_keys (person_id, key, essay_id, kind) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING RETURNING key`, [person.id, key, essayId, kind]);
  if (inserted.length) return { fresh: true };
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const stored = await one<{ essay_id: string; kind: string; status: number | null; body: unknown }>(
      "SELECT essay_id, kind, status, body FROM idempotency_keys WHERE person_id = $1 AND key = $2", [person.id, key]);
    if (!stored) return claimKey(person, key, essayId, kind);
    if (stored.essay_id !== essayId || stored.kind !== kind) {
      throw new ApiError(409, "idempotency_key_reused", "That Idempotency-Key was already used for a different request.");
    }
    if (stored.status !== null) return { fresh: false, status: stored.status, body: stored.body };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new ApiError(409, "idempotency_key_reused", "That Idempotency-Key is still in use by another request.");
}

on("POST", "/api/essays/:id/licences", "json", async (ctx: Ctx) => {
  const essayId = ctx.params[0] ?? "";
  await visibleEssay(ctx.person, essayId);
  requireRole(ctx.person, "picture_editor");
  const header = ctx.req.headers["idempotency-key"];
  const key = typeof header === "string" ? header : "";
  const { values, errors } = strictBody(ctx.body, { kind: { kind: "string", message: KIND_MESSAGE } });
  if (!/^[\x21-\x7e]{1,100}$/.test(key)) errors.add("idempotency_key", KEY_MESSAGE);
  if (typeof values.kind === "string" && values.kind !== "exclusive" && values.kind !== "standard") {
    errors.add("kind", KIND_MESSAGE);
  }
  errors.fail();
  const kind = values.kind as LicenceKind;
  const slot = await claimKey(ctx.person, key, essayId, kind);
  if (!slot.fresh) {
    sendJson(ctx.res, slot.status, slot.body);
    return;
  }
  let status: number;
  let body: unknown;
  try {
    ({ status, body } = await requestLicence(ctx.person, essayId, kind));
  } catch (error) {
    if (!(error instanceof ApiError) || error.status >= 503) {
      await query("DELETE FROM idempotency_keys WHERE person_id = $1 AND key = $2", [ctx.person.id, key]).catch(() => undefined);
      throw error;
    }
    status = error.status;
    body = errorBody(error);
    await query("UPDATE idempotency_keys SET status = $3, body = $4 WHERE person_id = $1 AND key = $2",
      [ctx.person.id, key, status, JSON.stringify(body)]);
    sendError(ctx.res, error);
    return;
  }
  await query("UPDATE idempotency_keys SET status = $3, body = $4 WHERE person_id = $1 AND key = $2",
    [ctx.person.id, key, status, JSON.stringify(body)]);
  sendJson(ctx.res, status, body);
});

// --- Grants -----------------------------------------------------------------------------------------

on("POST", "/api/licences/:id/grants", "json", async (ctx: Ctx) => {
  const now = await serverNow();
  const { row, state } = await ownLicence(ctx.person, ctx.params[0] ?? "", now);
  requireRole(ctx.person, "picture_editor");
  const { values, errors } = strictBody(ctx.body, { frame_id: { kind: "string", message: WRONG_TYPE } });
  errors.fail();
  const frame = await one<{ id: string; position: number; type: string }>(
    "SELECT id, position, type FROM frames WHERE id = $1 AND essay_id = $2", [values.frame_id, row.essay_id]);
  if (!frame) throw notFound();
  if (state === "pending_invoice") {
    throw new ApiError(409, "licence_pending", "The invoice is still pending; originals unlock when it is raised.");
  }
  if (state === "revoked") {
    throw new ApiError(410, "licence_revoked", "Licence revoked after a legal takedown. Originals are no longer available.");
  }
  const seconds = Math.min(GRANT_MAX_SECONDS, Math.floor((row.window_end.getTime() - now.getTime()) / 1000));
  if (state === "expired" || seconds <= 0) {
    throw new ApiError(410, "licence_ended",
      `This licence ended at ${coopTime(row.window_end)}. Originals are no longer available.`);
  }
  const key = keys.original(row.essay_id, frame.id);
  // Signing needs no round trip; this check is what answers storage_unavailable while MinIO is down.
  if (!(await objectExists(key))) throw notFound();
  const ext = frame.type === "image/png" ? "png" : "jpg";
  const url = presignGet(key, seconds, {
    "response-content-disposition": `attachment; filename="${row.essay_id}-frame-${frame.position}.${ext}"`,
    "response-content-type": frame.type,
  });
  sendJson(ctx.res, 201, { url, expires_at: isoInstant(new Date(now.getTime() + seconds * 1000)) });
});
