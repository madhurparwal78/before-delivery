import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { inUnit, type Unit } from "../db/unit";
import { alertLabel } from "../domain/alertLabel";
import { ApiError, invalidFields, refuse } from "../http/fail";
import { defineRoute, requireJsonObject, type Ctx, type Handler } from "../http/route";
import { openSession } from "../http/session";
import { generatedMark, generatedResume } from "../services/generated";
import { runDueJobs } from "../services/dueJobs";
import { closeAllStreams } from "../services/liveHub";
import { hashPassword } from "../services/passwords";
import { putObject, StorageUnavailable } from "../services/storage";
import {
  CITIES, COMPANY_SIZES, JOB_STATUSES, POST_KINDS, POST_STATES, ROLES, ROLE_FAMILIES, STAGES, WORK_PATTERNS, OUTCOMES,
} from "../../shared/reference";

type Item = Record<string, unknown>;
const COLLECTIONS = ["users", "companies", "channels", "posts", "replies", "jobs", "saved_jobs", "alerts", "applications", "channel_posts"] as const;
const POST_FIELDS = ["title", "overall", "work_life", "pay", "management", "pros", "cons", "role_family", "city", "annual_pay", "years_experience", "difficulty", "outcome", "text"];
const MAX_ADVANCE_SECONDS = 31536000;

function tokenMatches(supplied: string | string[] | undefined): boolean {
  const expected = config.gradingToken;
  if (expected === undefined || typeof supplied !== "string") return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(supplied), digest(expected));
}

/** The grading routes answer 404 unless the environment sets GRADING_TOKEN and the header equals it. */
async function requireGradingToken(ctx: Ctx): Promise<void> {
  if (!tokenMatches(ctx.req.headers["x-grading-token"])) throw refuse("not_found");
}

class SetupError extends Error {}
const text = (item: Item, name: string): string => {
  const value = item[name];
  if (typeof value !== "string" || value === "") throw new SetupError(`${name} is required`);
  return value;
};
const optionalText = (item: Item, name: string): string | undefined => (typeof item[name] === "string" ? String(item[name]) : undefined);
const oneOf = <const L extends readonly string[]>(item: Item, name: string, list: L): L[number] => {
  const found = list.find((entry) => entry === item[name]);
  if (found === undefined) throw new SetupError(`${name} is not one of ${list.join(", ")}`);
  return found;
};
const when = (item: Item, name: string): Date => {
  const moment = new Date(text(item, name));
  if (Number.isNaN(moment.getTime())) throw new SetupError(`${name} is not a time`);
  return moment;
};
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

function collection(body: unknown, name: (typeof COLLECTIONS)[number]): Item[] {
  const items = typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined;
  if (items === undefined) return [];
  if (!Array.isArray(items) || items.some((entry) => typeof entry !== "object" || entry === null)) throw new SetupError(`${name} must be a list`);
  return items as Item[];
}

function resolver(ids: Map<string, string>, known: Map<string, string>): (key: string, what: string) => string {
  return (key, what) => {
    const found = ids.get(key) ?? known.get(key);
    if (!found) throw new SetupError(`${what} ${key} is not defined`);
    return found;
  };
}

async function putGenerated(key: string, data: Buffer, contentType: string): Promise<void> {
  try {
    await putObject(key, data, contentType);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError("storage_unavailable");
    throw error;
  }
}

async function writeSetup(unit: Unit, body: unknown): Promise<{ ids: Record<string, string>; sessions: Record<string, string> }> {
  const ids = new Map<string, string>();
  const seededCompanies = new Map((await unit.rows<{ id: string; slug: string }>("SELECT id, slug FROM companies")).map((row) => [row.slug, row.id]));
  const seededChannels = new Map((await unit.rows<{ id: string; slug: string }>("SELECT id, slug FROM channels")).map((row) => [row.slug, row.id]));
  const company = resolver(ids, seededCompanies);
  const channel = resolver(ids, seededChannels);
  const reference = resolver(ids, new Map());
  const sessions: Record<string, string> = {};

  for (const item of collection(body, "companies")) {
    const key = text(item, "key");
    const created = await unit.first<{ id: string }>(
      `INSERT INTO companies (slug, name, city, size, verified, email_domain) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [text(item, "slug"), text(item, "name"), oneOf(item, "city", CITIES.map((c) => c.id)), oneOf(item, "size", COMPANY_SIZES), item["verified"] === true, text(item, "email_domain")],
    );
    if (!created) throw new SetupError("company was not created");
    ids.set(key, created.id);
    if (item["mark"] === true) {
      const objectKey = `marks/${created.id}.png`;
      const mark = generatedMark();
      await putGenerated(objectKey, mark, "image/png");
      const file = await unit.first<{ id: string }>("INSERT INTO files (object_key, content_type, size_bytes) VALUES ($1, 'image/png', $2) RETURNING id", [objectKey, mark.length]);
      await unit.query("UPDATE companies SET mark_file_id = $2 WHERE id = $1", [created.id, file?.id]);
    }
    await unit.syncSearch("companies", created.id);
  }

  const userItems = collection(body, "users");
  const hashes = await Promise.all(userItems.map((item) => hashPassword(text(item, "password"))));
  for (const [index, item] of userItems.entries()) {
    const role = oneOf(item, "role", ROLES);
    const employer = role === "employer_admin" || role === "recruiter";
    const companyId = employer ? company(text(item, "company"), "company") : null;
    const created = await unit.first<{ id: string }>(
      `INSERT INTO users (role, display_name, email, password_hash, company_id, unlocked) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [role, text(item, "display_name"), text(item, "email"), hashes[index], companyId, item["unlocked"] === true],
    );
    if (!created) throw new SetupError("user was not created");
    ids.set(text(item, "key"), created.id);
    sessions[text(item, "key")] = (await openSession(created.id, unit)).token;
  }

  for (const item of collection(body, "channels")) {
    const created = await unit.first<{ id: string }>("INSERT INTO channels (slug, name) VALUES ($1, $2) RETURNING id", [text(item, "slug"), text(item, "name")]);
    if (created) ids.set(text(item, "key"), created.id);
  }

  for (const item of collection(body, "posts")) {
    const kind = oneOf(item, "kind", POST_KINDS);
    const state = oneOf(item, "state", POST_STATES);
    if (kind === "pay_report") { oneOf(item, "role_family", ROLE_FAMILIES.map((r) => r.id)); oneOf(item, "city", CITIES.map((c) => c.id)); }
    if (kind === "interview_note") oneOf(item, "outcome", OUTCOMES.map((o) => o.id));
    const columns = POST_FIELDS.filter((name) => item[name] !== undefined);
    const claimedBy = state === "claimed" ? reference(text(item, "claimed_by"), "claimed_by") : null;
    const decidedBy = optionalText(item, "decided_by") ? reference(text(item, "decided_by"), "decided_by") : null;
    const created = await unit.first<{ id: string }>(
      `INSERT INTO posts (kind, company_id, author_id, state, created_at, claimed_by, claimed_at, decided_by, decided_at, reason${columns.map((name) => `, ${name}`).join("")})
       VALUES ($1, $2, $3, $4, $5, $6, ${claimedBy ? "app_now()" : "NULL"}, $7, ${decidedBy ? "app_now()" : "NULL"}, $8${columns.map((_, index) => `, $${index + 9}`).join("")})
       RETURNING id`,
      [kind, company(text(item, "company"), "company"), reference(text(item, "author"), "author"), state, when(item, "created_at"), claimedBy, decidedBy, optionalText(item, "reason") ?? null, ...columns.map((name) => item[name])],
    );
    if (!created) throw new SetupError("post was not created");
    ids.set(text(item, "key"), created.id);
    const actor = claimedBy ?? decidedBy;
    const type = state === "claimed" ? "claimed" : state === "approved" || state === "rejected" ? state : null;
    if (type && actor) {
      await unit.query(
        `INSERT INTO post_history (post_id, type, by_user_id, by_name, reason, at)
         SELECT $1, $2, u.id, u.display_name, $4, app_now() FROM users u WHERE u.id = $3`,
        [created.id, type, actor, type === "rejected" ? optionalText(item, "reason") ?? null : null],
      );
    }
    await unit.syncSearch("companies", company(text(item, "company"), "company"));
  }

  for (const item of collection(body, "replies")) {
    const review = reference(text(item, "review"), "review");
    await unit.query(
      "INSERT INTO replies (review_id, company_id, body, created_at) SELECT id, company_id, $2, app_now() FROM posts WHERE id = $1",
      [review, text(item, "body")],
    );
  }

  for (const item of collection(body, "jobs")) {
    const status = oneOf(item, "status", JOB_STATUSES);
    const created = await unit.first<{ id: string }>(
      `INSERT INTO jobs (company_id, title, role_family, city, remote, pay_low, pay_high, description, status, listed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        company(text(item, "company"), "company"), text(item, "title"), oneOf(item, "role_family", ROLE_FAMILIES.map((r) => r.id)),
        oneOf(item, "city", CITIES.map((c) => c.id)), oneOf(item, "remote", WORK_PATTERNS.map((w) => w.id)),
        item["pay_low"], item["pay_high"], text(item, "description"), status, status === "draft" ? null : when(item, "listed_at"),
      ],
    );
    if (!created) throw new SetupError("job was not created");
    ids.set(text(item, "key"), created.id);
    await unit.syncSearch("jobs", created.id);
  }

  for (const item of collection(body, "saved_jobs")) {
    await unit.query("INSERT INTO saved_jobs (user_id, job_id) VALUES ($1, $2)", [reference(text(item, "user"), "user"), reference(text(item, "job"), "job")]);
  }

  for (const item of collection(body, "alerts")) {
    const filters = { q: optionalText(item, "q") ?? "", city: strings(item["city"]), role: strings(item["role"]), remote: strings(item["remote"]), band: strings(item["band"]) };
    const created = await unit.first<{ id: string }>(
      "INSERT INTO alerts (user_id, q, city, role, remote, band, label) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [reference(text(item, "user"), "user"), filters.q, filters.city, filters.role, filters.remote, filters.band, alertLabel(filters)],
    );
    if (created) ids.set(text(item, "key"), created.id);
  }

  for (const item of collection(body, "applications")) {
    const fileId = randomUUID();
    const objectKey = `resumes/${fileId}.pdf`;
    const resume = generatedResume(text(item, "candidate_name"));
    await putGenerated(objectKey, resume, "application/pdf");
    await unit.query("INSERT INTO files (id, object_key, content_type, size_bytes) VALUES ($1, $2, 'application/pdf', $3)", [fileId, objectKey, resume.length]);
    const applied = when(item, "applied_at");
    const created = await unit.first<{ id: string }>(
      `INSERT INTO applications (job_id, user_id, candidate_name, contact_email, phone, cover_note, stage, applied_at, updated_at, resume_file_id)
       VALUES ($1, $2, $3, $4, '', '', $5, $6, $6, $7) RETURNING id`,
      [reference(text(item, "job"), "job"), reference(text(item, "user"), "user"), text(item, "candidate_name"), text(item, "contact_email"), oneOf(item, "stage", STAGES.map((s) => s.id)), applied, fileId],
    );
    if (created) ids.set(text(item, "key"), created.id);
  }

  for (const item of collection(body, "channel_posts")) {
    const created = await unit.first<{ id: string }>(
      "INSERT INTO channel_posts (channel_id, author_id, body, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
      [channel(text(item, "channel"), "channel"), reference(text(item, "author"), "author"), text(item, "body"), when(item, "created_at")],
    );
    if (created) ids.set(text(item, "key"), created.id);
  }

  return { ids: Object.fromEntries(ids), sessions };
}

const setup = defineRoute({
  method: "POST",
  path: "/api/grading/setup",
  auth: "public",
  body: "json",
  load: requireGradingToken,
  async run(ctx) {
    try {
      const result = await inUnit((unit) => writeSetup(unit, requireJsonObject(ctx)));
      return { status: 201, body: result };
    } catch (error) {
      if (error instanceof SetupError) throw invalidFields({ setup: error.message });
      if (error instanceof Error && "code" in error && (error.code === "23505" || error.code === "23503" || error.code === "22P02")) {
        throw invalidFields({ setup: error.message });
      }
      throw error;
    }
  },
});

const advance = defineRoute({
  method: "POST",
  path: "/api/grading/clock",
  auth: "public",
  body: "json",
  load: requireGradingToken,
  input(ctx) {
    const seconds = typeof ctx.json === "object" && ctx.json !== null ? (ctx.json as Record<string, unknown>)["advance_seconds"] : undefined;
    if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 0 || seconds > MAX_ADVANCE_SECONDS) {
      throw invalidFields({ advance_seconds: `Use a whole number of seconds from 0 to ${MAX_ADVANCE_SECONDS}.` });
    }
    return seconds;
  },
  async run(_ctx, _loaded, seconds) {
    const now = await inUnit(async (unit) => {
      await unit.query("UPDATE clock SET offset_seconds = offset_seconds + $1 WHERE id = 1", [seconds]);
      return unit.now();
    });
    await runDueJobs();
    return { status: 200, body: { now: now.toISOString() } };
  },
});

const closeStreams = defineRoute({
  method: "POST",
  path: "/api/grading/live/close",
  auth: "public",
  load: requireGradingToken,
  async run() {
    return { status: 200, body: { closed: closeAllStreams() } };
  },
});

export const gradingRoutes: Handler[] = [setup, advance, closeStreams];
