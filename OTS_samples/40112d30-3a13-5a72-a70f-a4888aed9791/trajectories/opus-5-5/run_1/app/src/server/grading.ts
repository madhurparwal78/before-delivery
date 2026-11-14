import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { allQuestions, findQuestion } from "../shared/changes.js";
import type { Answers, Definition } from "../shared/types.js";
import { createSession, createUser, hashPassword } from "./auth.js";
import { fromLocal, isoWithOffset, localDate, now, setClockOffset } from "./clock.js";
import { config } from "./config.js";
import { one, tx } from "./db.js";
import { answerFits } from "./engine/checks.js";
import { checkDefinition, locatedProblems, StructureError } from "./engine/definition.js";
import { calcValue, isAnswered, isLit, walkForm } from "./engine/walk.js";
import { ApiError, notFound } from "./errors.js";
import { newSlug } from "./forms.js";
import { json, type Ctx, type Router } from "./http.js";

class SeedProblem extends Error {}

function invalid(message: string): never {
  throw new SeedProblem(message);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";

function requireGradingKey(ctx: Ctx): void {
  const given = ctx.header("x-grading-key");
  if (!config.gradingKey || !given) throw notFound();
  const a = Buffer.from(given);
  const b = Buffer.from(config.gradingKey);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw notFound();
}

function checkSeedDefinition(value: unknown, where: string, edition: boolean): Definition {
  try {
    checkDefinition(value);
  } catch (error) {
    if (error instanceof StructureError) invalid(`${where}: ${error.message}`);
    throw error;
  }
  if (edition) {
    const problem = locatedProblems(value)[0];
    if (problem) invalid(`${where}: ${problem.message}`);
  }
  return value;
}

function localTime(value: unknown, where: string): Date | null {
  if (value === undefined || value === null) return null;
  const date = isString(value) ? fromLocal(value) : null;
  if (!date) invalid(`${where}: times are written YYYY-MM-DDTHH:MM.`);
  return date;
}

function seedAnswers(def: Definition, value: unknown, where: string): Answers {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) invalid(`${where}: answers must be an object.`);
  const answers: Answers = {};
  for (const [key, answer] of Object.entries(value)) {
    const question = findQuestion(def, key)?.question;
    if (!question) invalid(`${where}: there is no question ${key}.`);
    const fileShape = question.type === "file" && isRecord(answer) && isString(answer.name) && typeof answer.size === "number" && isString(answer.type);
    if (!fileShape && !answerFits(question, answer)) invalid(`${where}: the answer to ${key} does not fit the question.`);
    if (answer !== null) answers[key] = answer as Answers[string];
  }
  return answers;
}

interface SeedUser {
  id: string;
  session: string;
}

async function seedUsers(client: pg.PoolClient, raw: unknown): Promise<Record<string, SeedUser>> {
  const users: Record<string, SeedUser> = {};
  if (raw === undefined) return users;
  if (!Array.isArray(raw)) invalid("users must be a list.");
  for (const [i, user] of raw.entries()) {
    if (!isRecord(user) || ![user.key, user.name, user.email, user.password].every(isString))
      invalid(`users[${i}] needs key, name, email and password.`);
    const email = user.email as string;
    const existing = await one<{ id: string }>("SELECT id FROM users WHERE email_lower = $1", [email.toLowerCase()], client);
    let id: string;
    if (existing) {
      id = existing.id;
      await client.query("UPDATE users SET name = $2, email = $3, password_hash = $4 WHERE id = $1", [
        id,
        user.name,
        email,
        await hashPassword(user.password as string),
      ]);
    } else id = (await createUser(user.name as string, email, user.password as string, client)).id;
    users[user.key as string] = { id, session: await createSession(id, client) };
  }
  return users;
}

async function seedForm(client: pg.PoolClient, raw: unknown, users: Record<string, SeedUser>, index: number): Promise<[string, unknown]> {
  const where = `forms[${index}]`;
  if (!isRecord(raw) || !isString(raw.key) || !isString(raw.owner)) invalid(`${where} needs a key and an owner.`);
  const owner = users[raw.owner];
  if (!owner) invalid(`${where}: owner ${raw.owner} is not in users.`);
  const editors = raw.editors ?? [];
  if (!Array.isArray(editors) || !editors.every((e) => isString(e) && users[e])) invalid(`${where}: editors must name users.`);
  const editionsRaw = raw.editions ?? [];
  if (!Array.isArray(editionsRaw)) invalid(`${where}: editions must be a list.`);
  const editions = editionsRaw.map((d, i) => checkSeedDefinition(d, `${where}.editions[${i}]`, true));
  const draft =
    raw.draft === undefined || raw.draft === null ? editions[editions.length - 1] : checkSeedDefinition(raw.draft, `${where}.draft`, false);
  if (!draft) invalid(`${where} needs editions or a draft.`);
  const settings = isRecord(raw.settings) ? raw.settings : {};
  const closesAt = localTime(settings.closes_at, `${where}.settings.closes_at`);
  const limit = settings.response_limit ?? null;
  if (limit !== null && !(typeof limit === "number" && Number.isInteger(limit) && limit >= 1))
    invalid(`${where}.settings.response_limit must be a whole number of 1 or more.`);
  const id = randomUUID();
  const slug = newSlug();
  const created = now();
  await client.query(
    `INSERT INTO forms (id, slug, owner_id, title, draft, closes_at, closes_local, response_limit, closed_message, copy_to, live_edition, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      slug,
      owner.id,
      draft.title,
      JSON.stringify(draft),
      closesAt,
      closesAt ? (settings.closes_at as string).replace(" ", "T").slice(0, 16) : null,
      limit,
      isString(settings.closed_message) ? settings.closed_message : null,
      isString(settings.copy_to) ? settings.copy_to : null,
      editions.length || null,
      created,
    ],
  );
  for (const editor of editors as string[])
    await client.query("INSERT INTO form_editors (form_id, user_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [id, users[editor].id, created]);
  for (const [i, definition] of editions.entries())
    await client.query("INSERT INTO editions (form_id, number, definition, published_at) VALUES ($1, $2, $3, $4)", [
      id,
      i + 1,
      JSON.stringify(definition),
      created,
    ]);
  const responses: Record<string, unknown> = {};
  let submitted = 0;
  const responseList = raw.responses ?? [];
  if (!Array.isArray(responseList)) invalid(`${where}.responses must be a list.`);
  for (const [i, entry] of responseList.entries()) {
    const at = `${where}.responses[${i}]`;
    if (!isRecord(entry) || !isString(entry.key) || !["partial", "submitted"].includes(String(entry.status)))
      invalid(`${at} needs a key and a status of partial or submitted.`);
    const edition = entry.edition ?? editions.length;
    if (!(typeof edition === "number" && Number.isInteger(edition) && edition >= 1 && edition <= editions.length))
      invalid(`${at}: edition ${String(edition)} does not exist.`);
    const def = editions[edition - 1];
    const answers = seedAnswers(def, entry.answers, at);
    const responseId = randomUUID();
    const walk = walkForm(def, answers, localDate(now()));
    if (entry.status === "submitted") {
      const submittedAt = localTime(entry.submitted_at, `${at}.submitted_at`) ?? created;
      const kept: Answers = {};
      const values: Record<string, unknown> = {};
      for (const q of allQuestions(def)) {
        if (!isLit(walk, q.key)) continue;
        if (q.type === "calculated") values[q.key] = calcValue(q, walk);
        else if (isAnswered(answers[q.key])) kept[q.key] = answers[q.key];
      }
      await client.query(
        `INSERT INTO responses (id, form_id, edition, status, answers, page, expires_at, created_at, submitted_at, calc_values)
         VALUES ($1, $2, $3, 'submitted', $4, $5, $6, $6, $6, $7)`,
        [responseId, id, edition, JSON.stringify(kept), walk.litPages[walk.litPages.length - 1] ?? def.pages[0].key, submittedAt, JSON.stringify(values)],
      );
      submitted++;
      responses[entry.key] = { id: responseId, reference: responseId.slice(0, 8) };
    } else {
      const savedAt = localTime(entry.saved_at, `${at}.saved_at`);
      const email = isString(entry.email) ? entry.email : null;
      const page = isString(entry.page) ? entry.page : (walk.litPages[0] ?? def.pages[0].key);
      if (!def.pages.some((p) => p.key === page)) invalid(`${at}: there is no page ${page}.`);
      const start = savedAt ?? created;
      const token = email ? randomBytes(24).toString("hex") : null;
      await client.query(
        `INSERT INTO responses (id, form_id, edition, status, answers, page, resume_token, resume_email, saved_at, expires_at, created_at)
         VALUES ($1, $2, $3, 'partial', $4, $5, $6, $7, $8, $9, $10)`,
        [responseId, id, edition, JSON.stringify(answers), page, token, email, savedAt, new Date(start.getTime() + config.resumeTtlHours * 3600_000), start],
      );
      responses[entry.key] = { id: responseId, resume_url: token ? `${config.baseUrl}/r/${token}` : null };
    }
  }
  await client.query("UPDATE forms SET submitted_count = $2 WHERE id = $1", [id, submitted]);
  if (editions.length) {
    const limitReached = limit !== null && submitted >= limit;
    await client.query("UPDATE forms SET state = $2, closed_reason = $3 WHERE id = $1", [
      id,
      limitReached ? "closed" : "open",
      limitReached ? "limit" : null,
    ]);
  }
  return [
    raw.key,
    {
      id,
      slug,
      fill_url: `${config.baseUrl}/f/${slug}`,
      edit_url: `${config.baseUrl}/forms/${id}/edit`,
      summary_url: `${config.baseUrl}/forms/${id}/summary`,
      responses,
    },
  ];
}

export function registerGradingRoutes(router: Router): void {
  router.add("POST", "/api/grading/seed", async (ctx) => {
    requireGradingKey(ctx);
    const body = ctx.json();
    try {
      const reply = await tx(async (client) => {
        const users = await seedUsers(client, body.users);
        const forms: Record<string, unknown> = {};
        const list = body.forms ?? [];
        if (!Array.isArray(list)) invalid("forms must be a list.");
        for (const [i, form] of list.entries()) {
          const [key, value] = await seedForm(client, form, users, i);
          forms[key] = value;
        }
        return { users, forms };
      });
      return json(201, reply);
    } catch (error) {
      if (error instanceof SeedProblem) throw new ApiError("SEED_INVALID", error.message);
      throw error;
    }
  });

  router.add("POST", "/api/grading/clock", async (ctx) => {
    requireGradingKey(ctx);
    const value = ctx.json().now;
    let offset = 0;
    if (value !== null && value !== undefined) {
      const at = isString(value) ? Date.parse(value) : NaN;
      if (Number.isNaN(at)) throw new ApiError("VALIDATION_FAILED", undefined, [{ key: "now", message: "Give an ISO 8601 instant or null." }]);
      offset = at - Date.now();
    }
    await one("INSERT INTO app_clock (id, offset_ms) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET offset_ms = $1", [Math.round(offset)]);
    setClockOffset(Math.round(offset));
    return json(200, { now: isoWithOffset(now()) });
  });
}
