import { randomBytes, randomUUID } from "node:crypto";
import { applyChange, findQuestion, PAGE_FIELDS, FORM_FIELDS, resolveTarget } from "../shared/changes.js";
import { M } from "../shared/messages.js";
import type { Answers, Change, Definition, ErrorItem, PublicUser, Question, Settings } from "../shared/types.js";
import { requireUser, tokenHash } from "./auth.js";
import { isEmail } from "./engine/checks.js";
import { formatDateTime, fromLocal, isoWithOffset, localDate, now } from "./clock.js";
import { config } from "./config.js";
import { one, query, tx } from "./db.js";
import { answerFits } from "./engine/checks.js";
import {
  checkDefinition,
  checkQuestion,
  checkQuestionKey,
  firstProblem,
  locatedProblems,
  StructureError,
  type LocatedProblem,
} from "./engine/definition.js";
import { buildEvaluation, walkForm } from "./engine/walk.js";
import { ApiError, notFound, validationFailed } from "./errors.js";
import {
  accessForm,
  applySettings,
  closeByHand,
  editionDefinition,
  loadForm,
  newSlug,
  publish,
  reopen,
  roleOf,
  settingsOf,
  withClock,
  type FormRow,
  type Role,
} from "./forms.js";
import { json, type Router } from "./http.js";
import { announceFormState, onLiveChange } from "./live.js";
import { deliverNow, enqueueMail } from "./mail.js";
import { keys, publish as publishLive, valkey, valkeyUp } from "./valkey.js";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;

function changeInvalid(message: string): ApiError {
  return new ApiError("CHANGE_INVALID", message);
}

/** Checks the outer shape of a change. */
function parseChange(raw: unknown, rev: number): Change {
  if (!isRecord(raw)) throw changeInvalid("A change must be an object.");
  const base_rev = typeof raw.base_rev === "number" && Number.isInteger(raw.base_rev) ? raw.base_rev : rev;
  switch (raw.op) {
    case "set":
      if (!isString(raw.key) || !isString(raw.field)) throw changeInvalid("A set change needs a key and a field.");
      return { op: "set", key: raw.key, field: raw.field, value: raw.value ?? null, base_rev };
    case "add_question":
      if (!isString(raw.page) || !isRecord(raw.question)) throw changeInvalid("add_question needs a page and a question.");
      return { op: "add_question", page: raw.page, question: raw.question as unknown as Question, base_rev };
    case "remove_question":
    case "remove_page":
      if (!isString(raw.key)) throw changeInvalid(`${raw.op} needs a key.`);
      return { op: raw.op, key: raw.key, base_rev };
    case "move_question":
      if (!isString(raw.key) || !isPosInt(raw.position)) throw changeInvalid("move_question needs a key and a position.");
      return { op: "move_question", key: raw.key, position: raw.position, base_rev };
    case "add_page":
      if (!isRecord(raw.page) || !isPosInt(raw.position)) throw changeInvalid("add_page needs a page and a position.");
      return { op: "add_page", page: raw.page as unknown as Definition["pages"][number], position: raw.position, base_rev };
    default:
      throw changeInvalid(`Unknown change ${String(raw.op)}.`);
  }
}

/** Fills the fields the Add question dialog may leave out. */
function withDefaults(question: Question): Question {
  const filled = { ...question };
  if (filled.type === "grid") {
    filled.rows ??= [{ value: "row_1", label: "Row 1" }];
    filled.columns ??= [{ value: "col_1", label: "Column 1" }];
  }
  if (filled.type === "scale") {
    filled.min ??= 1;
    filled.max ??= 5;
  }
  if (filled.type === "calculated") filled.formula ??= "";
  return filled;
}

function checkSetField(draft: Definition, change: Extract<Change, { op: "set" }>): void {
  const target = resolveTarget(draft, change.key, change.field);
  if (target?.kind === "question" && (change.field === "key" || change.field === "type"))
    throw changeInvalid("The key and type of a question cannot be changed.");
  if (target?.kind === "page" && !(PAGE_FIELDS as readonly string[]).includes(change.field)) throw changeInvalid(`Pages have no field ${change.field}.`);
  if (target?.kind === "form" && !(FORM_FIELDS as readonly string[]).includes(change.field)) throw changeInvalid(`Forms have no field ${change.field}.`);
}

function structureToApi(error: StructureError): ApiError {
  if (error.code === "DUPLICATE_KEY") return new ApiError("DUPLICATE_KEY", M.duplicateKey);
  if (error.code === "VALIDATION_FAILED") return validationFailed([{ key: error.key ?? "", message: M.keyFormat }]);
  return changeInvalid(error.message);
}

const problemId = (p: LocatedProblem): string => `${p.key}|${p.field}|${p.message}`;

/** The save-time refusal a `set` or `add_question` change brings in, if any. */
function refusalOf(before: Definition, after: Definition, change: Change, formulaGiven: boolean): LocatedProblem | null {
  if (change.op === "add_question")
    return firstProblem(after, (p) => p.key === change.question.key && p.field !== "checks" && (formulaGiven || p.field !== "formula"));
  if (change.op !== "set") return null;
  if (change.key === "form") {
    if (change.field !== "checks") return null;
    const existing = new Set(locatedProblems(before).map(problemId));
    return firstProblem(after, (p) => p.field === "checks" && !existing.has(problemId(p)));
  }
  return firstProblem(after, (p) => p.key === change.key && p.field === change.field);
}

async function nextSeq(form: FormRow): Promise<number> {
  if (valkeyUp()) {
    try {
      let seq = await valkey.incr(keys.seq(form.id));
      if (seq <= form.rev) {
        seq = form.rev + 1;
        await valkey.set(keys.seq(form.id), String(seq));
      }
      return seq;
    } catch {
      return form.rev + 1;
    }
  }
  return form.rev + 1;
}

export interface Applied {
  seq: number | null;
  conflict_with: string | null;
  /** The change as applied, with any filled-in defaults. */
  change?: Change;
  dropped?: boolean;
}

/** Applies one co-editing change under the form's row lock, giving it the next server order. */
async function applyOne(formId: string, user: PublicUser, raw: unknown): Promise<Applied> {
  return tx(async (client) => {
    const form = await loadForm(formId, client, true);
    if (!form) throw notFound();
    const change = parseChange(raw, form.rev);
    const formulaGiven = change.op !== "add_question" || change.question.formula !== undefined;
    const draft = structuredClone(form.draft);
    try {
      if (change.op === "add_question") {
        checkQuestionKey(change.question.key);
        change.question = withDefaults(change.question);
        checkQuestion(change.question);
      }
      if (change.op === "set") checkSetField(form.draft, change);
      if (!applyChange(draft, change)) return { seq: null, conflict_with: null, dropped: true };
      checkDefinition(draft);
    } catch (error) {
      if (error instanceof StructureError) throw structureToApi(error);
      throw error;
    }
    const refusal = refusalOf(form.draft, draft, change, formulaGiven);
    if (refusal) throw new ApiError("FORMULA_INVALID", refusal.message, [{ key: refusal.key, message: refusal.message }]);
    const seq = await nextSeq(form);
    let conflictWith: string | null = null;
    const fieldRevs = { ...form.field_revs };
    if (change.op === "set") {
      const fieldKey = `${change.key}|${change.field}`;
      const prior = fieldRevs[fieldKey];
      if (prior && prior.rev > change.base_rev && prior.user !== user.id) conflictWith = prior.user;
      fieldRevs[fieldKey] = { rev: seq, user: user.id };
    }
    await client.query("UPDATE forms SET draft = $2, rev = $3, field_revs = $4, title = $5 WHERE id = $1", [
      form.id,
      JSON.stringify(draft),
      seq,
      JSON.stringify(fieldRevs),
      draft.title,
    ]);
    await publishLive(keys.formChannel(form.id), {
      type: "applied",
      seq,
      by: { id: user.id, name: user.name },
      change,
      conflict_with: conflictWith,
    });
    return { seq, conflict_with: conflictWith, change };
  });
}

function trialAnswers(draft: Definition, raw: unknown): Answers {
  const answers: Answers = {};
  if (!isRecord(raw)) return answers;
  for (const [key, value] of Object.entries(raw)) {
    const found = findQuestion(draft, key);
    if (!found || !answerFits(found.question, value)) throw new ApiError("ANSWER_INVALID");
    if (value !== null) answers[key] = value as Answers[string];
  }
  return answers;
}

const present = (v: unknown): boolean => v !== undefined && v !== null && v !== "";

function readSettings(body: Record<string, unknown>, draft: Definition): { settings: Settings; closesAt: Date | null } {
  const items: ErrorItem[] = [];
  let closesAt: Date | null = null;
  let closesLocal: string | null = null;
  if (present(body.closes_at)) {
    const text = isString(body.closes_at) ? body.closes_at.trim() : "";
    closesAt = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(text) ? fromLocal(text) : null;
    if (closesAt) closesLocal = text.replace(" ", "T");
    else items.push({ key: "closes_at", message: M.closingTimeFormat });
  }
  let limit: number | null = null;
  if (present(body.response_limit)) {
    const raw = body.response_limit;
    const n = typeof raw === "number" ? raw : isString(raw) && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= 2_000_000_000) limit = n;
    else items.push({ key: "response_limit", message: M.limitFormat });
  }
  let copyTo: string | null = null;
  if (present(body.copy_to)) {
    const found = isString(body.copy_to) ? findQuestion(draft, body.copy_to) : null;
    if (found && found.question.type === "short_text" && found.question.pattern === "email") copyTo = found.question.key;
    else items.push({ key: "copy_to", message: M.chooseEmailQuestion });
  }
  if (items.length) throw validationFailed(items);
  const message = isString(body.closed_message) && body.closed_message.trim() !== "" ? body.closed_message : null;
  return { settings: { closes_at: closesLocal, response_limit: limit, closed_message: message, copy_to: copyTo }, closesAt };
}

function formReply(form: FormRow, role: string): Record<string, unknown> {
  return {
    id: form.id,
    slug: form.slug,
    title: form.draft.title,
    role,
    state: form.state,
    closed_reason: form.closed_reason,
    edition: form.live_edition,
    rev: form.rev,
    draft: form.draft,
    problems: locatedProblems(form.draft).map((p) => ({ key: p.key, message: p.message })),
    settings: settingsOf(form),
    responses: form.submitted_count,
    server_now: isoWithOffset(now()),
  };
}

export function registerBuilderRoutes(router: Router): void {
  onLiveChange(async (form, user, change) => {
    const role = await roleOf(form, user.id);
    if (!role || (role === "editor" && form.state === "closed")) throw notFound();
    const result = await applyOne(form.id, user, change);
    if (result.dropped) throw new ApiError("CHANGE_INVALID", M.questionGone);
  });

  router.add("GET", "/api/forms", async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await query<FormRow & { role: Role }>(
      `SELECT f.*, CASE WHEN f.owner_id = $1 THEN 'owner' ELSE 'editor' END AS role FROM forms f
       WHERE f.owner_id = $1 OR EXISTS (SELECT 1 FROM form_editors e WHERE e.form_id = f.id AND e.user_id = $1)
       ORDER BY f.created_at DESC`,
      [user.id],
    );
    return json(200, {
      forms: rows.map(withClock).map((f) => ({ id: f.id, title: f.title, role: f.role, state: f.state, edition: f.live_edition, responses: f.submitted_count })),
    });
  });

  router.add("POST", "/api/forms", async (ctx) => {
    const user = await requireUser(ctx);
    const title = isString(ctx.json().title) ? (ctx.json().title as string).trim() : "";
    if (!title) throw validationFailed([{ key: "title", message: M.enterTitle }]);
    const id = randomUUID();
    const slug = newSlug();
    const draft: Definition = { title, pages: [{ key: "page_1", title: "Page 1", questions: [] }], checks: [] };
    await query("INSERT INTO forms (id, slug, owner_id, title, draft, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [
      id,
      slug,
      user.id,
      title,
      JSON.stringify(draft),
      now(),
    ]);
    return json(201, { id, slug, title });
  });

  router.add("GET", "/api/forms/:id", async (ctx) => {
    const { form, role } = await accessForm(ctx, ctx.params[0], "builder");
    return json(200, formReply(form, role));
  });

  router.add("GET", "/api/forms/:id/info", async (ctx) => {
    const { form, role } = await accessForm(ctx, ctx.params[0], "read");
    return json(200, { id: form.id, slug: form.slug, title: form.title, role, state: form.state, edition: form.live_edition });
  });

  router.add("POST", "/api/forms/:id/changes", async (ctx) => {
    const { form, user } = await accessForm(ctx, ctx.params[0], "builder");
    const changes = ctx.json().changes;
    if (!Array.isArray(changes)) throw changeInvalid("changes must be a list.");
    const applied: Applied[] = [];
    for (const change of changes) applied.push(await applyOne(form.id, user, change));
    const latest = await loadForm(form.id);
    return json(200, { rev: latest?.rev ?? form.rev, applied });
  });

  router.add("POST", "/api/forms/:id/trial", async (ctx) => {
    const { form } = await accessForm(ctx, ctx.params[0], "builder");
    const body = ctx.json();
    const answers = trialAnswers(form.draft, body.answers);
    const walk = walkForm(form.draft, answers, localDate(now()));
    const seq = typeof body.seq === "number" ? body.seq : 0;
    const lastCalc = form.draft.pages
      .flatMap((p) => p.questions)
      .filter((q) => q.type === "calculated" && !q.hidden)
      .pop();
    const evaluation = buildEvaluation(walk, {
      seq,
      audience: "builder",
      announce: (e) =>
        lastCalc
          ? M.pathWithValue(e.shown_pages, form.draft.pages.length, lastCalc.label, e.values[lastCalc.key].text)
          : M.path(e.shown_pages, form.draft.pages.length),
    });
    return json(200, evaluation);
  });

  router.add("POST", "/api/forms/:id/publish", async (ctx) => {
    const { form } = await accessForm(ctx, ctx.params[0], "owner");
    const result = await tx(async (client) => publish(client, (await loadForm(form.id, client, true)) as FormRow));
    await announceFormState(result.form);
    return json(200, { edition: result.edition });
  });

  router.add("PUT", "/api/forms/:id/settings", async (ctx) => {
    const { form } = await accessForm(ctx, ctx.params[0], "owner");
    const { settings, closesAt } = readSettings(ctx.json(), form.draft);
    const updated = await tx(async (client) =>
      applySettings(client, (await loadForm(form.id, client, true)) as FormRow, settings, closesAt),
    );
    await announceFormState(updated);
    return json(200, { settings: settingsOf(updated), state: updated.state, closed_reason: updated.closed_reason });
  });

  router.add("POST", "/api/forms/:id/close", async (ctx) => {
    const { form } = await accessForm(ctx, ctx.params[0], "owner");
    const updated = await tx(async (client) => closeByHand(client, (await loadForm(form.id, client, true)) as FormRow));
    await announceFormState(updated);
    return json(200, { state: updated.state, closed_reason: updated.closed_reason });
  });

  router.add("POST", "/api/forms/:id/reopen", async (ctx) => {
    const { form } = await accessForm(ctx, ctx.params[0], "owner");
    const result = await tx(async (client) => reopen(client, (await loadForm(form.id, client, true)) as FormRow));
    await announceFormState(result.form);
    return json(200, { state: result.form.state, edition: result.edition });
  });

  router.add("POST", "/api/forms/:id/invitations", async (ctx) => {
    const { form, user } = await accessForm(ctx, ctx.params[0], "owner");
    const email = isString(ctx.json().email) ? (ctx.json().email as string).trim() : "";
    if (!isEmail(email)) throw validationFailed([{ key: "email", message: M.enterEmail }]);
    const token = randomBytes(24).toString("hex");
    const expires = new Date(now().getTime() + config.inviteTtlHours * 3600_000);
    const mailId = await tx(async (client) => {
      await client.query("INSERT INTO invitations (token_hash, form_id, email, inviter_id, expires_at) VALUES ($1, $2, $3, $4, $5)", [
        tokenHash(token),
        form.id,
        email,
        user.id,
        expires,
      ]);
      const body = [
        `${user.name} invited you to edit ${form.title} on Nightform.`,
        "",
        `Open this link to join: ${config.baseUrl}/invite/${token}`,
        "",
        `The link works once, until ${formatDateTime(expires)}.`,
      ].join("\n");
      return enqueueMail(client, email, `Join ${form.title} on Nightform`, body);
    });
    void deliverNow(mailId);
    return json(202, { message: M.invitationSent(email) });
  });

  const findInvitation = async (token: string): Promise<{ form_id: string; title: string } | null> =>
    one<{ form_id: string; title: string }>(
      `SELECT i.form_id, f.title FROM invitations i JOIN forms f ON f.id = i.form_id
       WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at >= $2`,
      [tokenHash(token), now()],
    );

  router.add("GET", "/api/invitations/:token", async (ctx) => {
    const invitation = await findInvitation(ctx.params[0]);
    if (!invitation) throw notFound();
    return json(200, { form_title: invitation.title });
  });

  router.add("POST", "/api/invitations/:token/accept", async (ctx) => {
    const user = await requireUser(ctx);
    const formId = await tx(async (client) => {
      const row = await one<{ form_id: string; owner_id: string }>(
        `UPDATE invitations i SET used_at = $2 FROM forms f
         WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at >= $2 AND f.id = i.form_id
         RETURNING i.form_id, f.owner_id`,
        [tokenHash(ctx.params[0]), now()],
        client,
      );
      if (!row) throw notFound();
      if (row.owner_id !== user.id)
        await client.query("INSERT INTO form_editors (form_id, user_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [
          row.form_id,
          user.id,
          now(),
        ]);
      return row.form_id;
    });
    return json(200, { form_id: formId });
  });

  router.add("GET", "/api/forms/:id/editions", async (ctx) => {
    const { form } = await accessForm(ctx, ctx.params[0], "read");
    const rows = await query<{ number: number; published_at: Date }>(
      "SELECT number, published_at FROM editions WHERE form_id = $1 ORDER BY number",
      [form.id],
    );
    return json(200, { editions: rows.map((r) => ({ number: r.number, published_at: isoWithOffset(r.published_at) })) });
  });

  router.add("GET", "/api/forms/:id/editions/:n", async (ctx) => {
    const { form } = await accessForm(ctx, ctx.params[0], "read");
    const number = Number(ctx.params[1]);
    if (!Number.isInteger(number) || number < 1) throw notFound();
    const row = await one<{ published_at: Date }>("SELECT published_at FROM editions WHERE form_id = $1 AND number = $2", [form.id, number]);
    if (!row) throw notFound();
    return json(200, { number, published_at: isoWithOffset(row.published_at), definition: await editionDefinition(form.id, number) });
  });
}
