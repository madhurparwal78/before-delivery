import { randomBytes } from "node:crypto";
import type pg from "pg";
import { formatLocalDateTime } from "../shared/formats.js";
import { M } from "../shared/messages.js";
import type { ClosedInfo, ClosedReason, Definition, FormState, PublicUser, Settings } from "../shared/types.js";
import { requireUser } from "./auth.js";
import { now } from "./clock.js";
import { config } from "./config.js";
import { one, pool, type Db } from "./db.js";
import { locatedProblems } from "./engine/definition.js";
import { ApiError, notFound } from "./errors.js";
import type { Ctx } from "./http.js";

export interface FormRow {
  id: string;
  slug: string;
  owner_id: string;
  title: string;
  draft: Definition;
  rev: number;
  field_revs: Record<string, { rev: number; user: string }>;
  state: FormState;
  closed_reason: ClosedReason | null;
  live_edition: number | null;
  closes_at: Date | null;
  closes_local: string | null;
  response_limit: number | null;
  closed_message: string | null;
  copy_to: string | null;
  submitted_count: number;
  created_at: Date;
}

export type Role = "owner" | "editor";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function newSlug(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(randomBytes(10), (b) => alphabet[b % alphabet.length]).join("");
}

/** An open form whose closing time the server clock has reached is closed by time. */
export function withClock<T extends FormRow>(form: T): T {
  if (form.state === "open" && form.closes_at && form.closes_at.getTime() <= now().getTime())
    return { ...form, state: "closed", closed_reason: "time" };
  return form;
}

export async function loadForm(id: string, db: Db = pool, lock = false): Promise<FormRow | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const row = await one<FormRow>(`SELECT * FROM forms WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id], db);
  return row && withClock(row);
}

export async function loadFormBySlug(slug: string): Promise<FormRow | null> {
  const row = await one<FormRow>("SELECT * FROM forms WHERE slug = $1", [slug]);
  return row && withClock(row);
}

export async function roleOf(form: FormRow, userId: string, db: Db = pool): Promise<Role | null> {
  if (form.owner_id === userId) return "owner";
  const editor = await one("SELECT 1 FROM form_editors WHERE form_id = $1 AND user_id = $2", [form.id, userId], db);
  return editor ? "editor" : null;
}

export interface FormAccess {
  form: FormRow;
  user: PublicUser;
  role: Role;
}

/** Signs in, finds the form and checks the person may use it; everything refused answers 404. */
export async function accessForm(ctx: Ctx, id: string, scope: "read" | "builder" | "owner"): Promise<FormAccess> {
  const user = await requireUser(ctx);
  const form = await loadForm(id);
  if (!form) throw notFound();
  const role = await roleOf(form, user.id);
  if (!role) throw notFound();
  if (scope === "owner" && role !== "owner") throw notFound();
  if (scope === "builder" && role === "editor" && form.state === "closed") throw notFound();
  return { form, user, role };
}

export function settingsOf(form: FormRow): Settings {
  return {
    closes_at: form.closes_local,
    response_limit: form.response_limit,
    closed_message: form.closed_message,
    copy_to: form.copy_to,
  };
}

/** Why the settings close an open form right now, if they do. */
export function closingReason(form: FormRow, at: Date = now()): ClosedReason | null {
  if (form.closes_at && form.closes_at.getTime() <= at.getTime()) return "time";
  if (form.response_limit !== null && form.submitted_count >= form.response_limit) return "limit";
  return null;
}

export function closedText(form: FormRow): string {
  if (form.closed_message) return form.closed_message;
  switch (form.closed_reason) {
    case "time":
      return M.closedByTime(formatLocalDateTime(form.closes_local ?? ""), config.timeZone);
    case "limit":
      return M.closedByLimit(form.response_limit ?? form.submitted_count);
    default:
      return M.closedByHand;
  }
}

export function closedInfo(form: FormRow): ClosedInfo | null {
  return form.state === "closed" ? { heading: M.closedHeading, text: closedText(form) } : null;
}

async function setState(db: Db, formId: string, state: FormState, reason: ClosedReason | null): Promise<FormRow> {
  return (await one<FormRow>(
    "UPDATE forms SET state = $2, closed_reason = $3 WHERE id = $1 RETURNING *",
    [formId, state, reason],
    db,
  )) as FormRow;
}

/** Records a reached closing time or limit on an open form, so later setting changes cannot reopen it. */
export async function settle(db: Db, formId: string): Promise<FormRow> {
  const row = (await one<FormRow>("SELECT * FROM forms WHERE id = $1", [formId], db)) as FormRow;
  if (row.state !== "open") return row;
  const reason = closingReason(row);
  return reason ? setState(db, formId, "closed", reason) : row;
}

const editionCache = new Map<string, Definition>();

export async function editionDefinition(formId: string, number: number, db: Db = pool): Promise<Definition> {
  const cacheKey = `${formId}:${number}`;
  const cached = editionCache.get(cacheKey);
  if (cached) return cached;
  const row = await one<{ definition: string }>("SELECT definition FROM editions WHERE form_id = $1 AND number = $2", [formId, number], db);
  if (!row) throw notFound();
  const definition = JSON.parse(row.definition) as Definition;
  editionCache.set(cacheKey, definition);
  return definition;
}

/** Makes the draft the next numbered edition; refused while the draft has problems. */
export async function publishDraft(client: pg.PoolClient, form: FormRow): Promise<{ form: FormRow; edition: number }> {
  const problems = locatedProblems(form.draft);
  if (problems.length)
    throw new ApiError(
      "FORMULA_PROBLEMS",
      M.formulaProblems(problems.length),
      problems.map((p) => ({ key: p.key, message: p.message })),
    );
  const edition = (form.live_edition ?? 0) + 1;
  await client.query("INSERT INTO editions (form_id, number, definition, published_at) VALUES ($1, $2, $3, $4)", [
    form.id,
    edition,
    JSON.stringify(form.draft),
    now(),
  ]);
  const updated = (await one<FormRow>(
    "UPDATE forms SET live_edition = $2, title = $3 WHERE id = $1 RETURNING *",
    [form.id, edition, form.draft.title],
    client,
  )) as FormRow;
  return { form: updated, edition };
}

/** Publish: a draft opens (or closes at once if its settings close it); open and closed keep their state. */
export async function publish(client: pg.PoolClient, form: FormRow): Promise<{ form: FormRow; edition: number }> {
  const published = await publishDraft(client, form);
  if (form.state !== "draft") return { form: withClock(published.form), edition: published.edition };
  await setState(client, form.id, "open", null);
  return { form: withClock(await settle(client, form.id)), edition: published.edition };
}

export async function closeByHand(client: pg.PoolClient, form: FormRow): Promise<FormRow> {
  if (form.state === "draft") throw new ApiError("FORM_DRAFT");
  if (form.state === "closed") return form;
  return setState(client, form.id, "closed", "hand");
}

/** Reopen: publishes the draft, clears hand-closing and any reached closing time or limit. */
export async function reopen(client: pg.PoolClient, form: FormRow): Promise<{ form: FormRow; edition: number }> {
  if (form.state === "open") throw new ApiError("FORM_OPEN");
  if (form.state === "draft") throw new ApiError("FORM_DRAFT");
  const published = await publishDraft(client, form);
  const at = now();
  const timeReached = form.closes_at !== null && form.closes_at.getTime() <= at.getTime();
  const limitReached = form.response_limit !== null && form.submitted_count >= form.response_limit;
  const updated = (await one<FormRow>(
    `UPDATE forms SET state = 'open', closed_reason = NULL,
       closes_at = CASE WHEN $2 THEN NULL ELSE closes_at END,
       closes_local = CASE WHEN $2 THEN NULL ELSE closes_local END,
       response_limit = CASE WHEN $3 THEN NULL ELSE response_limit END
     WHERE id = $1 RETURNING *`,
    [form.id, timeReached, limitReached],
    client,
  )) as FormRow;
  return { form: withClock(updated), edition: published.edition };
}

/** Saving settings may close an open form; it never reopens a closed one. */
export async function applySettings(client: pg.PoolClient, form: FormRow, settings: Settings, closesAt: Date | null): Promise<FormRow> {
  await settle(client, form.id);
  await client.query(
    `UPDATE forms SET closes_at = $2, closes_local = $3, response_limit = $4, closed_message = $5, copy_to = $6 WHERE id = $1`,
    [form.id, closesAt, settings.closes_at, settings.response_limit, settings.closed_message, settings.copy_to],
  );
  return withClock(await settle(client, form.id));
}

/** Counts one submission against the limit row, closing the form when the limit is reached. */
export async function countSubmission(client: pg.PoolClient, form: FormRow): Promise<FormRow> {
  await client.query("UPDATE forms SET submitted_count = submitted_count + 1 WHERE id = $1", [form.id]);
  return settle(client, form.id);
}
