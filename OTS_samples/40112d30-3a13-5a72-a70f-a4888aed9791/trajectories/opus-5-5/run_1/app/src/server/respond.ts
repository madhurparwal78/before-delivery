import { createHash, randomBytes, randomUUID } from "node:crypto";
import { allQuestions, findQuestion } from "../shared/changes.js";
import { formatSize } from "../shared/formats.js";
import { M } from "../shared/messages.js";
import type { AnswerValue, Answers, Definition, Evaluation, FileKind, Question } from "../shared/types.js";
import { formatDateTime, isoWithOffset, localDate, localDateTime, now } from "./clock.js";
import { config } from "./config.js";
import { one, pool, query, tx, type Db } from "./db.js";
import { answerFits, answerStillValid, isEmail, pageErrors } from "./engine/checks.js";
import { Decimal } from "./engine/decimal.js";
import { buildEvaluation, calcValue, commitAnnouncement, displayText, fill, isAnswered, isLit, pageAnnouncement, walkForm, type Walk } from "./engine/walk.js";
import { ApiError, notFound, validationFailed } from "./errors.js";
import { closedText, countSubmission, editionDefinition, loadForm, loadFormBySlug, UUID_PATTERN, type FormRow } from "./forms.js";
import { readBody, json, type Ctx, type Router } from "./http.js";
import { announceFormState } from "./live.js";
import { deliverNow, enqueueMail } from "./mail.js";
import { deleteObject, putObject, StorageError } from "./storage.js";
import { pushSummary } from "./summary.js";
import { keys, publish, withinLimit } from "./valkey.js";

export interface ResponseRow {
  id: string;
  form_id: string;
  edition: number;
  status: "partial" | "submitted" | "expired";
  answers: Answers;
  page: string;
  device: string | null;
  former_devices: string[];
  resume_token: string | null;
  resume_email: string | null;
  saved_at: Date | null;
  expires_at: Date;
  created_at: Date;
  submitted_at: Date | null;
  calc_values: Record<string, { value: string | null; text: string }> | null;
}

const resumeTtlMs = config.resumeTtlHours * 3600_000;
const isString = (v: unknown): v is string => typeof v === "string";

/** A link stays valid through its expiry second and lapses one second after. */
export function lapsed(response: Pick<ResponseRow, "expires_at">): boolean {
  return Math.floor(now().getTime() / 1000) > Math.floor(response.expires_at.getTime() / 1000);
}

/** Marks part-done responses whose resume window has lapsed as expired. */
export async function expireLapsedResponses(): Promise<void> {
  await query("UPDATE responses SET status = 'expired' WHERE status = 'partial' AND expires_at < $1", [new Date(now().getTime() - 1000)]);
}

function today(): string {
  return localDate(now());
}

function closedError(form: FormRow): ApiError {
  return new ApiError("FORM_CLOSED", closedText(form));
}

/* ---------- Views ---------- */

function firstLitPage(walk: Walk): string {
  return walk.litPages[0] ?? walk.def.pages[0].key;
}

/** The page to show: the requested one when the walk shows it, or the nearest shown page before it. */
function shownPage(walk: Walk, page: string): string {
  if (walk.litPages.includes(page)) return page;
  const index = walk.def.pages.findIndex((p) => p.key === page);
  for (let i = index; i >= 0; i--) if (walk.litPages.includes(walk.def.pages[i].key)) return walk.def.pages[i].key;
  return firstLitPage(walk);
}

function evaluate(def: Definition, answers: Answers, seq: number, page: string, previous?: Walk): { walk: Walk; evaluation: Evaluation } {
  const walk = walkForm(def, answers, today());
  const evaluation = buildEvaluation(walk, {
    seq,
    audience: "respondent",
    previous,
    announce: (e) => pageAnnouncement(walk, page, e),
  });
  return { walk, evaluation };
}

async function respondentView(form: FormRow, response: ResponseRow, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const def = await editionDefinition(form.id, response.edition);
  const walk = walkForm(def, response.answers, today());
  const page = shownPage(walk, response.page);
  const { evaluation } = evaluate(def, response.answers, 0, page);
  return {
    id: response.id,
    edition: response.edition,
    page,
    answers: response.answers,
    evaluation,
    title: def.title,
    intro: def.intro ?? null,
    today: today(),
    ...extra,
  };
}

/* ---------- Access ---------- */

type SubmitOutcome =
  | { kind: "replay"; reply: Record<string, unknown> }
  | { kind: "invalid"; error: ApiError }
  | {
      kind: "submitted";
      reply: Record<string, unknown>;
      mailId: string | null;
      form: FormRow;
      discarded: { object_key: string }[];
    };

interface Held {
  form: FormRow;
  response: ResponseRow;
  def: Definition;
}

interface Found {
  response: ResponseRow;
  lost: boolean;
}

/** The 404 part of the precedence: the response exists, belongs to this device (or did), and has not lapsed. */
async function findResponse(ctx: Ctx, id: string, db: Db, lock: boolean): Promise<Found> {
  if (!UUID_PATTERN.test(id)) throw notFound();
  const response = await one<ResponseRow>(`SELECT * FROM responses WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id], db);
  const device = ctx.device();
  if (!response) throw notFound();
  const lost = response.device !== device && response.former_devices.includes(device);
  if (response.device !== device && !lost) throw notFound();
  if (response.status === "expired" || (response.status === "partial" && lapsed(response))) throw new ApiError("LINK_EXPIRED");
  return { response, lost };
}

/** The 409 part of the precedence: still held, not yet sent, and the form is open. */
async function requireOpen(found: Found, db: Db): Promise<Held> {
  if (found.lost) throw new ApiError("DRAFT_MOVED");
  if (found.response.status === "submitted") throw new ApiError("ALREADY_SUBMITTED");
  const form = (await loadForm(found.response.form_id, db)) as FormRow;
  if (form.state !== "open") throw closedError(form);
  return { form, response: found.response, def: await editionDefinition(form.id, found.response.edition, db) };
}

async function holdResponse(ctx: Ctx, id: string, db: Db, lock: boolean): Promise<Held> {
  return requireOpen(await findResponse(ctx, id, db, lock), db);
}

function pageKey(def: Definition, value: unknown, fallback: string): string {
  return isString(value) && def.pages.some((p) => p.key === value) ? value : fallback;
}

/* ---------- Email bodies ---------- */

function answerLines(walk: Walk, questions: Question[]): string[] {
  return questions
    .filter((q) => isLit(walk, q.key) && !(q.type === "calculated" && q.hidden))
    .map((q) => `${fill(q.label, walk)}: ${displayText(q, walk) ?? M.noAnswer}`);
}

function resumeBody(def: Definition, walk: Walk, page: string, token: string, expires: Date): string {
  const upTo = def.pages.findIndex((p) => p.key === page);
  const questions = def.pages.slice(0, upTo + 1).flatMap((p) => p.questions);
  return [
    `Continue your form: ${def.title}`,
    "",
    `Open this link to carry on: ${config.baseUrl}/r/${token}`,
    `The link works until ${formatDateTime(expires)}.`,
    "",
    "Your answers so far:",
    ...answerLines(walk, questions),
  ].join("\n");
}

function copyBody(walk: Walk, reference: string): string {
  return [M.reference(reference), ...answerLines(walk, allQuestions(walk.def))].join("\n");
}

/* ---------- Files ---------- */

const FILE_TYPES: Record<string, FileKind> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpeg" };
const TYPE_NAMES: Record<FileKind, string> = { pdf: "PDF", png: "PNG", jpeg: "JPEG" };

function typesText(accept: FileKind[]): string {
  const names = (["pdf", "png", "jpeg"] as FileKind[]).filter((k) => accept.includes(k)).map((k) => TYPE_NAMES[k]);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

function fileName(header: string | null): string {
  let name = "file";
  try {
    name = decodeURIComponent(header ?? "file");
  } catch {
    name = header ?? "file";
  }
  const cleaned = Array.from(name.split(/[\\/]/).pop() ?? "")
    .filter((c) => c.charCodeAt(0) >= 32 && c !== "\u007f" && c !== '"')
    .join("")
    .trim();
  return cleaned.slice(0, 200) || "file";
}

async function removeFiles(rows: { object_key: string }[]): Promise<void> {
  for (const row of rows) await deleteObject(row.object_key).catch(() => undefined);
}

/* ---------- Migration onto a newer edition ---------- */

function migrate(oldDef: Definition, newDef: Definition, answers: Answers): { kept: Answers; dropped: string[] } {
  const kept: Answers = {};
  const dropped: string[] = [];
  const oldWalk = walkForm(oldDef, answers, today());
  for (const question of allQuestions(oldDef)) {
    const value = answers[question.key];
    if (value === undefined || !isAnswered(value)) continue;
    const next = findQuestion(newDef, question.key)?.question;
    if (next && next.type === question.type && answerStillValid(next, value)) kept[question.key] = value;
    else dropped.push(fill(question.label, oldWalk));
  }
  return { kept, dropped };
}

function droppedKeys(oldAnswers: Answers, kept: Answers): Set<string> {
  return new Set(Object.keys(oldAnswers).filter((k) => isAnswered(oldAnswers[k]) && !(k in kept)));
}

function resumePage(walk: Walk, dropped: Set<string>, saved: string): string {
  for (const pageKeyValue of walk.litPages) {
    const page = walk.def.pages.find((p) => p.key === pageKeyValue);
    const needs = page?.questions.some(
      (q) => isLit(walk, q.key) && ((q.required && q.type !== "calculated" && !isAnswered(walk.answers[q.key])) || dropped.has(q.key)),
    );
    if (needs) return pageKeyValue;
  }
  return shownPage(walk, saved);
}

/* ---------- Routes ---------- */

export function registerRespondentRoutes(router: Router): void {
  const liveForm = async (slug: string): Promise<FormRow> => {
    const form = await loadFormBySlug(slug);
    if (!form || form.live_edition === null) throw notFound();
    return form;
  };

  router.add("GET", "/api/f/:slug", async (ctx) => {
    const form = await liveForm(ctx.params[0]);
    const def = await editionDefinition(form.id, form.live_edition as number);
    return json(200, {
      title: def.title,
      intro: def.intro ?? null,
      state: form.state,
      closed: form.state === "closed" ? { heading: M.closedHeading, text: closedText(form) } : null,
      today: today(),
    });
  });

  router.add("POST", "/api/f/:slug/responses", async (ctx) => {
    const form = await liveForm(ctx.params[0]);
    const device = ctx.device();
    if (form.state !== "open") throw closedError(form);
    const existing = await one<ResponseRow>(
      "SELECT * FROM responses WHERE form_id = $1 AND device = $2 AND status = 'partial' ORDER BY created_at DESC LIMIT 1",
      [form.id, device],
    );
    if (existing && !lapsed(existing)) return json(200, await respondentView(form, existing));
    const def = await editionDefinition(form.id, form.live_edition as number);
    const created = now();
    const response = (await one<ResponseRow>(
      `INSERT INTO responses (id, form_id, edition, status, answers, page, device, expires_at, created_at)
       VALUES ($1, $2, $3, 'partial', '{}', $4, $5, $6, $7) RETURNING *`,
      [randomUUID(), form.id, form.live_edition, firstLitPage(walkForm(def, {}, today())), device, new Date(created.getTime() + resumeTtlMs), created],
    )) as ResponseRow;
    return json(201, await respondentView(form, response));
  });

  router.add("GET", "/api/responses/:id", async (ctx) => {
    const { form, response } = await holdResponse(ctx, ctx.params[0], pool, false);
    return json(200, await respondentView(form, response));
  });

  router.add("POST", "/api/responses/:id/answers", async (ctx) => {
    const body = ctx.json();
    const evaluation = await tx(async (client) => {
      const { response, def } = await holdResponse(ctx, ctx.params[0], client, true);
      const page = pageKey(def, body.page, response.page);
      const answers: Answers = { ...response.answers };
      const incoming = body.answers && typeof body.answers === "object" && !Array.isArray(body.answers) ? (body.answers as Record<string, unknown>) : {};
      for (const [key, value] of Object.entries(incoming)) {
        const found = findQuestion(def, key);
        if (!found || !answerFits(found.question, value)) throw new ApiError("ANSWER_INVALID");
        if (value === null) delete answers[key];
        else answers[key] = value as AnswerValue;
      }
      const seq = typeof body.seq === "number" ? body.seq : 0;
      const before = evaluate(def, response.answers, seq, page);
      const after = evaluate(def, answers, seq, page, before.walk);
      after.evaluation.announce = commitAnnouncement(before.evaluation, after.evaluation, page);
      await client.query("UPDATE responses SET answers = $2, page = $3 WHERE id = $1", [response.id, JSON.stringify(answers), page]);
      return after.evaluation;
    });
    return json(200, { evaluation });
  });

  const move = (direction: 1 | -1) => async (ctx: Ctx) => {
    const body = ctx.json();
    return tx(async (client) => {
      const { response, def } = await holdResponse(ctx, ctx.params[0], client, true);
      const walk = walkForm(def, response.answers, today());
      const current = shownPage(walk, pageKey(def, body.page, response.page));
      if (direction === 1) {
        const errors = pageErrors(walk, current);
        if (errors.length) throw new ApiError("ANSWERS_INVALID", M.summaryAlert(errors.length), errors);
      }
      const index = walk.litPages.indexOf(current);
      const target = walk.litPages[Math.max(0, Math.min(walk.litPages.length - 1, index + direction))];
      await client.query("UPDATE responses SET page = $2 WHERE id = $1", [response.id, target]);
      const { evaluation } = evaluate(def, response.answers, 0, target);
      return json(200, { page: target, evaluation });
    });
  };
  router.add("POST", "/api/responses/:id/next", move(1));
  router.add("POST", "/api/responses/:id/back", move(-1));

  router.add("POST", "/api/responses/:id/save", async (ctx) => {
    const body = ctx.json();
    const hour = localDateTime(now()).replace(/\D/g, "").slice(0, 10);
    const result = await tx(async (client) => {
      const found = await findResponse(ctx, ctx.params[0], client, true);
      if (!(await withinLimit(keys.resumeLimit(ctx.ip, hour), config.resumeEmailPerHour, 3600))) throw new ApiError("RATE_LIMITED");
      const { response, def } = await requireOpen(found, client);
      const email = isString(body.email) ? body.email.trim() : "";
      if (!isEmail(email)) throw validationFailed([{ key: "email", message: M.enterEmail }]);
      const page = pageKey(def, body.page, response.page);
      const saved = now();
      const expires = new Date(saved.getTime() + resumeTtlMs);
      const token = response.resume_token ?? randomBytes(24).toString("hex");
      await client.query(
        "UPDATE responses SET page = $2, resume_email = $3, saved_at = $4, expires_at = $5, resume_token = $6 WHERE id = $1",
        [response.id, page, email, saved, expires, token],
      );
      const walk = walkForm(def, response.answers, today());
      const mailId = await enqueueMail(client, email, `Continue your form: ${def.title}`, resumeBody(def, walk, page, token, expires));
      return { email, expires, mailId };
    });
    const sent = await deliverNow(result.mailId);
    return json(200, {
      email: result.email,
      expires_at: isoWithOffset(result.expires),
      sent,
      message: sent ? M.linkSent(result.email, formatDateTime(result.expires)) : M.emailQueued,
    });
  });

  router.add("POST", "/api/responses/:id/submit", async (ctx) => {
    const key = ctx.header("idempotency-key");
    const bodyHash = createHash("sha256").update(JSON.stringify({ page: ctx.json().page ?? null })).digest("hex");
    const minute = localDateTime(now()).replace(/\D/g, "");
    const outcome = await tx(async (client): Promise<SubmitOutcome> => {
      if (!UUID_PATTERN.test(ctx.params[0])) throw notFound();
      const owner = await one<{ form_id: string }>("SELECT form_id FROM responses WHERE id = $1", [ctx.params[0]], client);
      if (owner) await loadForm(owner.form_id, client, true);
      const found = await findResponse(ctx, ctx.params[0], client, true);
      if (!(await withinLimit(keys.submitLimit(ctx.ip, minute), config.submitPerMinute, 60))) throw new ApiError("RATE_LIMITED");
      if (key) {
        const record = await one<{ response_id: string; body_hash: string; result: Record<string, unknown> }>(
          "SELECT response_id, body_hash, result FROM idempotency WHERE key = $1",
          [key],
          client,
        );
        if (record && (record.response_id !== found.response.id || record.body_hash !== bodyHash)) throw new ApiError("IDEMPOTENCY_CONFLICT");
        if (record) return { kind: "replay", reply: { ...record.result, replayed: true } };
      }
      const held = await requireOpen(found, client);
      if (!key) throw new ApiError("IDEMPOTENCY_KEY_REQUIRED");
      const { form, response, def } = held;
      const walk = walkForm(def, response.answers, today());
      const ordered = [shownPage(walk, response.page), ...walk.litPages];
      for (const page of ordered) {
        const errors = pageErrors(walk, page);
        if (errors.length) {
          await client.query("UPDATE responses SET page = $2 WHERE id = $1", [response.id, page]);
          return { kind: "invalid", error: new ApiError("ANSWERS_INVALID", M.summaryAlert(errors.length), errors) };
        }
      }
      const kept: Answers = {};
      for (const question of allQuestions(def))
        if (isLit(walk, question.key) && question.type !== "calculated" && isAnswered(response.answers[question.key]))
          kept[question.key] = response.answers[question.key];
      const values: Record<string, { value: string | null; text: string }> = {};
      for (const question of allQuestions(def))
        if (question.type === "calculated" && isLit(walk, question.key)) values[question.key] = calcValue(question, walk);
      const discarded = await query<{ object_key: string }>(
        "DELETE FROM files WHERE response_id = $1 AND NOT (question_key = ANY($2::text[])) RETURNING object_key",
        [response.id, Object.keys(kept)],
        client,
      );
      const submittedAt = now();
      await client.query(
        "UPDATE responses SET status = 'submitted', answers = $2, calc_values = $3, submitted_at = $4, page = $5 WHERE id = $1",
        [response.id, JSON.stringify(kept), JSON.stringify(values), submittedAt, response.page],
      );
      const updatedForm = await countSubmission(client, form);
      const reference = response.id.slice(0, 8);
      let mailId: string | null = null;
      const copyTo = form.copy_to;
      const copyQuestion = copyTo ? findQuestion(def, copyTo)?.question : undefined;
      const copyAddress = copyQuestion && isString(kept[copyQuestion.key]) ? (kept[copyQuestion.key] as string).trim() : "";
      if (copyAddress && isEmail(copyAddress))
        mailId = await enqueueMail(client, copyAddress, `Your copy: ${def.title}`, copyBody(walkForm(def, kept, today()), reference));
      const reply = {
        id: response.id,
        reference,
        submitted_at: isoWithOffset(submittedAt),
        edition: response.edition,
        copy: mailId ? "queued" : "none",
        replayed: false,
      };
      const stored = await query(
        "INSERT INTO idempotency (key, response_id, body_hash, result, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key) DO NOTHING RETURNING key",
        [key, response.id, bodyHash, JSON.stringify(reply), submittedAt],
        client,
      );
      if (stored.length === 0) throw new ApiError("IDEMPOTENCY_CONFLICT");
      return { kind: "submitted", reply, mailId, form: updatedForm, discarded };
    });
    if (outcome.kind === "invalid") throw outcome.error;
    if (outcome.kind === "replay") return json(200, outcome.reply);
    const reply: Record<string, unknown> = { ...outcome.reply };
    if (outcome.mailId) {
      reply.copy = (await deliverNow(outcome.mailId)) ? "sent" : "queued";
      await query("UPDATE idempotency SET result = $2 WHERE key = $1", [key, JSON.stringify(reply)]);
    }
    await removeFiles(outcome.discarded);
    await announceFormState(outcome.form);
    await pushSummary(outcome.form.id);
    return json(200, reply);
  });

  router.add(
    "PUT",
    "/api/responses/:id/files/:key",
    async (ctx) => {
      const { form, response, def } = await holdResponse(ctx, ctx.params[0], pool, false);
      const question = findQuestion(def, ctx.params[1])?.question;
      if (!question || question.type !== "file") throw notFound();
      const name = fileName(ctx.header("x-file-name"));
      const label = fill(question.label, walkForm(def, response.answers, today()));
      const accept = question.accept ?? ["pdf", "png", "jpeg"];
      const contentType = (ctx.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const kind = FILE_TYPES[contentType];
      if (!kind || !accept.includes(kind)) throw new ApiError("FILE_TYPE", M.fileType(label, typesText(accept)));
      const maxBytes = question.max_bytes ?? config.uploadMaxBytes;
      const megabytes = Decimal.fromInt(maxBytes).div(Decimal.fromInt(1048576)).toText();
      const tooLarge = (): ApiError => new ApiError("FILE_TOO_LARGE", M.fileTooLarge(label, megabytes));
      const bytes = await readBody(ctx.req, maxBytes, tooLarge);
      const fileId = randomUUID();
      const objectKey = `files/${form.id}/${response.id}/${question.key}/${fileId}`;
      try {
        await putObject(objectKey, bytes, contentType);
      } catch (error) {
        if (error instanceof StorageError) throw new ApiError("UPLOAD_FAILED", M.uploadFailed(name));
        throw error;
      }
      const answer = { name, size: bytes.length, type: contentType };
      const replaced = await tx(async (client) => {
        await holdResponse(ctx, response.id, client, true);
        const old = await query<{ object_key: string }>(
          "DELETE FROM files WHERE response_id = $1 AND question_key = $2 RETURNING object_key",
          [response.id, question.key],
          client,
        );
        await client.query(
          "INSERT INTO files (id, form_id, response_id, question_key, name, size, type, object_key, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
          [fileId, form.id, response.id, question.key, name, bytes.length, contentType, objectKey, now()],
        );
        await client.query("UPDATE responses SET answers = answers || $2::jsonb WHERE id = $1", [
          response.id,
          JSON.stringify({ [question.key]: answer }),
        ]);
        return old;
      });
      await removeFiles(replaced);
      return json(201, { ...answer, text: M.attached(name, formatSize(bytes.length)) });
    },
    true,
  );

  router.add("DELETE", "/api/responses/:id/files/:key", async (ctx) => {
    const removed = await tx(async (client) => {
      const { response, def } = await holdResponse(ctx, ctx.params[0], client, true);
      const question = findQuestion(def, ctx.params[1])?.question;
      if (!question || question.type !== "file") throw notFound();
      await client.query("UPDATE responses SET answers = answers - $2 WHERE id = $1", [response.id, question.key]);
      return query<{ object_key: string }>(
        "DELETE FROM files WHERE response_id = $1 AND question_key = $2 RETURNING object_key",
        [response.id, question.key],
        client,
      );
    });
    await removeFiles(removed);
    return json(204);
  });

  router.add("POST", "/api/resume/:token", async (ctx) => {
    const device = ctx.device();
    const result = await tx(async (client) => {
      const response = await one<ResponseRow>("SELECT * FROM responses WHERE resume_token = $1 FOR UPDATE", [ctx.params[0]], client);
      if (!response) throw notFound();
      if (response.status === "submitted") throw new ApiError("ALREADY_SENT");
      if (response.status === "expired" || lapsed(response)) throw new ApiError("LINK_EXPIRED");
      const form = (await loadForm(response.form_id, client)) as FormRow;
      if (form.state !== "open") throw closedError(form);
      const formerDevices =
        response.device && response.device !== device && !response.former_devices.includes(response.device)
          ? [...response.former_devices, response.device]
          : response.former_devices.filter((d) => d !== device);
      let { answers, edition, page } = response;
      let notice: string;
      let removed: { object_key: string }[] = [];
      const savedText = formatDateTime(response.saved_at ?? response.created_at);
      if (form.live_edition !== null && form.live_edition > response.edition) {
        const oldDef = await editionDefinition(form.id, response.edition, client);
        const newDef = await editionDefinition(form.id, form.live_edition, client);
        const migrated = migrate(oldDef, newDef, answers);
        const dropped = droppedKeys(answers, migrated.kept);
        answers = migrated.kept;
        edition = form.live_edition;
        page = resumePage(walkForm(newDef, answers, today()), dropped, page);
        notice = M.formChanged(migrated.dropped);
        removed = await query<{ object_key: string }>(
          "DELETE FROM files WHERE response_id = $1 AND NOT (question_key = ANY($2::text[])) RETURNING object_key",
          [response.id, Object.keys(answers)],
          client,
        );
      } else notice = M.welcomeBack(savedText);
      const updated = (await one<ResponseRow>(
        "UPDATE responses SET device = $2, former_devices = $3, answers = $4, edition = $5, page = $6 WHERE id = $1 RETURNING *",
        [response.id, device, formerDevices, JSON.stringify(answers), edition, page],
        client,
      )) as ResponseRow;
      return { form, response: updated, notice, removed };
    });
    await removeFiles(result.removed);
    await publish(keys.formChannel(result.form.id), { type: "moved", response: result.response.id, device });
    return json(
      200,
      await respondentView(result.form, result.response, {
        notice: result.notice,
        saved_at: isoWithOffset(result.response.saved_at ?? result.response.created_at),
      }),
    );
  });
}
