// Revisions are immutable: saving, copying, forking, restoring and publishing each append one, all or nothing,
// after every object it needs is stored and confirmed.
import { etagOf } from "../shared/copy";
import { roundHalfEven } from "../shared/numbers";
import { TITLE_MAX, boundedMessage, boundedText, graphemeCount, normalizeText } from "../shared/text";
import { evaluate, forkSource, measure, parseTine, type Model, type Solid, type Values } from "../shared/tine";
import type { Json } from "../shared/canonical";
import { randomBytes } from "node:crypto";
import type { User } from "./auth";
import { db, transaction, type Queries, type Tx } from "./db";
import { CATEGORIES } from "./categories";
import { ApiError, evaluationFailed, forbidden, invalid, notFound } from "./errors";
import { emit } from "./events";
import type { Ctx } from "./http";
import { get, post, type Route } from "./route";
import { idempotent } from "./idempotency";
import { runEvaluation } from "./evaluation";
import { newId } from "./ids";
import { headRevision, loadRevision, modelOf, readablePart, requirePart, revisionJson, revisionLabel, sourceText, type PartRow, type RevisionRow } from "./records";
import { jsonReply, type Reply } from "./reply";
import { applyRoomEffects } from "./rooms";
import { digestOf, sha256, solidBytes, thumbnailSvg } from "./solids";
import { confirmObject, putObject } from "./storage";
import { numericParameters, validateValues } from "./values";

const MESSAGE_MAX = 200;

interface TapeRow {
  index: number;
  kind: string;
  op: string;
  line: number | null;
  digest: string;
  volume: number;
  delta: number;
  bbox: [number, number, number];
}


/** House rule: `*`, or any listed quoted tag that is exactly the head's; a weak tag never matches. */
function ifMatchHolds(header: string, headId: string): boolean {
  return header.trim() === "*" || header.split(",").some((tag) => tag.trim() === etagOf(headId));
}

/** The head, once the request's If-Match has been checked against it: 428 without one, 412 when it is false. */
async function requireCurrentHead(queries: Queries, slug: string, ifMatch: string | undefined): Promise<RevisionRow> {
  const head = await headRevision(queries, slug);
  if (ifMatch === undefined) throw new ApiError(428, "precondition_required", "Send If-Match with the revision history's ETag.");
  if (!ifMatchHolds(ifMatch, head.id)) {
    throw new ApiError(
      412,
      "head_moved",
      `This part changed since you opened it. ${revisionLabel(head.n)} is now the latest revision.`,
      { headRevisionId: head.id, head: revisionJson(head) },
      { ETag: etagOf(head.id) },
    );
  }
  return head;
}

// ------------------------------------------------------------------------------------------------ preparing

interface Prepared {
  evaluationId: string;
  digest: string;
  sourceRef: string;
  sourceText: string;
  tape: TapeRow[];
}

/** One snapshot per tape operation, each a stored solid of its own. */
function buildTape(model: Model, values: Values): { tape: TapeRow[]; solids: Map<string, Solid> } {
  const solids = new Map<string, Solid>();
  let previous = 0;
  const tape = model.tape.map((step): TapeRow => {
    const outcome = evaluate(model, values, step.index);
    if (!outcome.ok) throw new Error(`tape step ${step.index} fails although the whole part evaluates`);
    const digest = digestOf(outcome.solid);
    solids.set(digest, outcome.solid);
    const { volume, bbox } = measure(outcome.solid);
    const row = { index: step.index, kind: step.kind, op: step.op, line: step.line, digest, volume, delta: roundHalfEven(volume - previous, 3), bbox };
    previous = volume;
    return row;
  });
  return { tape, solids };
}

/** Evaluates the values and stores the source, every tape solid and every thumbnail, each confirmed present. */
export async function prepareRevision(input: { partSlug: string; sourceText: string; values: Values; authorId: string }): Promise<Prepared> {
  const model = modelOf(input.sourceText);
  const evaluation = await runEvaluation({ partSlug: input.partSlug, model, values: input.values, viewerId: input.authorId, seq: 0 }, new AbortController());
  if (evaluation.status !== "succeeded") throw evaluationFailed(evaluation.diagnostics);
  const { tape, solids } = buildTape(model, input.values);
  const sourceBytes = Buffer.from(input.sourceText);
  const sourceRef = `sources/${sha256(sourceBytes)}.tine`;
  await Promise.all([
    putObject(sourceRef, sourceBytes, "text/plain; charset=utf-8"),
    ...[...solids].flatMap(([digest, solid]) => [
      putObject(`solids/${digest}.json`, solidBytes(solid), "application/json"),
      putObject(`thumbnails/${digest}.svg`, thumbnailSvg(solid), "image/svg+xml"),
    ]),
  ]);
  return { evaluationId: evaluation.id, digest: evaluation.geometryDigest as string, sourceRef, sourceText: input.sourceText, tape };
}

// ------------------------------------------------------------------------------------------------ committing

interface RevisionDraft {
  partSlug: string;
  authorId: string;
  values: Values;
  message: string;
  createdAt: Date;
  sourceRef: string;
  sourceText: string;
  evaluationId: string;
  digest: string;
  /** The tape to store, or a revision whose stored tape this one reuses. */
  tape: TapeRow[] | { copyFrom: string };
  restoredFrom?: string;
  forkedFrom?: { revisionId: string; operation: number };
}

async function insertTape(tx: Tx, revisionId: string, tape: RevisionDraft["tape"]): Promise<void> {
  if (!Array.isArray(tape)) {
    await tx.run(
      `INSERT INTO tape_operations (revision_id, idx, kind, op, line, digest, volume, delta, bbox)
       SELECT $1, idx, kind, op, line, digest, volume, delta, bbox FROM tape_operations WHERE revision_id = $2`,
      [revisionId, tape.copyFrom],
    );
    return;
  }
  await tx.run(
    `INSERT INTO tape_operations (revision_id, idx, kind, op, line, digest, volume, delta, bbox)
     SELECT $1, * FROM unnest($2::int[], $3::text[], $4::text[], $5::int[], $6::text[], $7::float8[], $8::float8[], $9::jsonb[])`,
    [
      revisionId,
      tape.map((t) => t.index),
      tape.map((t) => t.kind),
      tape.map((t) => t.op),
      tape.map((t) => t.line),
      tape.map((t) => t.digest),
      tape.map((t) => t.volume),
      tape.map((t) => t.delta),
      tape.map((t) => JSON.stringify(t.bbox)),
    ],
  );
}

/** Writes the revision row, its tape, its event and its room effects. The caller holds the part's row lock. */
async function appendRevision(tx: Tx, draft: RevisionDraft, head: RevisionRow | null): Promise<RevisionRow> {
  const id = newId();
  await tx.run("INSERT INTO sources (ref, text) VALUES ($1, $2) ON CONFLICT DO NOTHING", [draft.sourceRef, draft.sourceText]);
  const row = await tx.one<RevisionRow>(
    `INSERT INTO revisions (id, part_slug, n, parent_id, author_id, created_at, param_values, source_ref, evaluation_id, geometry_digest,
                            message, restored_from, forked_from_revision, forked_from_operation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
    [
      id, draft.partSlug, (head?.n ?? 0) + 1, head?.id ?? null, draft.authorId, draft.createdAt, JSON.stringify(draft.values),
      draft.sourceRef, draft.evaluationId, draft.digest, draft.message, draft.restoredFrom ?? null,
      draft.forkedFrom?.revisionId ?? null, draft.forkedFrom?.operation ?? null,
    ],
  );
  await insertTape(tx, id, draft.tape);
  const author = await tx.one<{ display_name: string }>("SELECT display_name FROM users WHERE id = $1", [draft.authorId]);
  const revision = revisionJson(row);
  await emit(tx, draft.partSlug, "revision", null, {
    type: "revision",
    revision,
    authorDisplayName: author.display_name,
    digestChanged: head?.geometry_digest !== draft.digest,
  });
  await applyRoomEffects(tx, draft.partSlug, head?.geometry_digest ?? null, draft.digest, revision.label);
  return row;
}

/** Appends to an existing part. `ifMatch` is the request's header; null appends to whatever the head is. */
export async function commitRevision(draft: RevisionDraft, ifMatch: string | null): Promise<RevisionRow> {
  return transaction(async (tx) => {
    await requirePart(tx, draft.partSlug, true);
    const head = ifMatch === null ? await headRevision(tx, draft.partSlug) : await requireCurrentHead(tx, draft.partSlug, ifMatch);
    return appendRevision(tx, draft, head);
  });
}

interface NewPart {
  slug: string;
  title: string;
  category: string;
  visibility: "public" | "private";
  ownerId: string;
  sourceText: string;
  values: Values;
  message: string;
  createdAt: Date;
  seedPosition?: number;
  listed?: boolean;
}

/** A new part with its r1: the evaluated, stored and confirmed `values` of its source. */
export async function createPart(spec: NewPart): Promise<RevisionRow> {
  const prepared = await prepareRevision({ partSlug: spec.slug, sourceText: spec.sourceText, values: spec.values, authorId: spec.ownerId });
  return transaction(async (tx) => {
    await tx.run(
      "INSERT INTO parts (slug, title, category, visibility, listed, owner_id, seed_position, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [spec.slug, spec.title, spec.category, spec.visibility, spec.listed ?? true, spec.ownerId, spec.seedPosition ?? null, spec.createdAt],
    );
    return appendRevision(tx, { ...prepared, partSlug: spec.slug, authorId: spec.ownerId, values: spec.values, message: spec.message, createdAt: spec.createdAt }, null);
  });
}

/** A slug nobody has: the title's words plus six random hex digits. */
export async function freshSlug(base: string): Promise<string> {
  const words = base.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  for (;;) {
    const slug = `${words || "part"}-${randomBytes(3).toString("hex")}`;
    if (!(await db.row("SELECT 1 FROM parts WHERE slug = $1", [slug]))) return slug;
  }
}

// ------------------------------------------------------------------------------------------------ routes

function createdReply(revision: RevisionRow): Reply {
  return jsonReply(201, revisionJson(revision), { Location: `/api/parts/${revision.part_slug}?revision=${revision.id}`, ETag: etagOf(revision.id) });
}

function newPartReply(slug: string, revision: RevisionRow): Reply {
  return jsonReply(201, { slug, revision: revisionJson(revision) }, { Location: `/api/parts/${slug}`, ETag: etagOf(revision.id) });
}

function parseMessage(raw: Json | undefined): string {
  const message = typeof raw === "string" ? normalizeText(raw) : "";
  if (graphemeCount(message) > MESSAGE_MAX) throw invalid({ message: `Use up to ${MESSAGE_MAX} characters.` });
  return message;
}

/** A revision of a part the caller owns: 401, then 404 for an unreadable or foreign revision, then 403. */
async function ownedRevision(ctx: Ctx, revisionId: string, slug?: string): Promise<{ user: User; part: PartRow; revision: RevisionRow }> {
  const user = await ctx.requireUser();
  const revision = await loadRevision(db, revisionId);
  if (!revision || (slug !== undefined && revision.part_slug !== slug)) throw notFound();
  const part = await readablePart(ctx, revision.part_slug);
  if (part.ownerId !== user.id) throw forbidden();
  return { user, part, revision };
}

async function save(ctx: Ctx): Promise<Reply> {
  const user = await ctx.requireUser();
  const part = await readablePart(ctx, ctx.params.slug);
  if (part.ownerId !== user.id) throw forbidden();
  return idempotent(ctx, user, async () => {
    const ifMatch = ctx.header("if-match");
    const head = await requireCurrentHead(db, part.slug, ifMatch);
    const source = await sourceText(db, head.source_ref);
    const model = modelOf(source);
    ctx.checkNumbers(numericParameters(model));
    const values = validateValues(model, ctx.json().values);
    const message = parseMessage(ctx.json().message);
    const prepared = await prepareRevision({ partSlug: part.slug, sourceText: source, values, authorId: user.id });
    const revision = await commitRevision({ ...prepared, partSlug: part.slug, authorId: user.id, values, message, createdAt: new Date() }, ifMatch as string);
    return createdReply(revision);
  });
}

async function copy(ctx: Ctx): Promise<Reply> {
  const user = await ctx.requireUser();
  const original = await readablePart(ctx, ctx.params.slug);
  return idempotent(ctx, user, async () => {
    const source = await sourceText(db, (await headRevision(db, original.slug)).source_ref);
    const model = modelOf(source);
    ctx.checkNumbers(numericParameters(model));
    const values = validateValues(model, ctx.json().values);
    const message = parseMessage(ctx.json().message);
    const slug = await freshSlug(original.slug);
    const first = await createPart({
      slug, title: `${original.title} (my configuration)`, category: original.category, visibility: "private", ownerId: user.id,
      sourceText: source, values, message, createdAt: new Date(),
    });
    return newPartReply(slug, first);
  });
}

async function restore(ctx: Ctx): Promise<Reply> {
  const { user, part, revision: old } = await ownedRevision(ctx, ctx.params.id, ctx.params.slug);
  return idempotent(ctx, user, async () => {
    const ifMatch = ctx.header("if-match");
    const head = await requireCurrentHead(db, part.slug, ifMatch);
    if (old.id === head.id) throw new ApiError(409, "already_head", `${revisionLabel(old.n)} is already the latest revision.`);
    await confirmObject(`solids/${old.geometry_digest}.json`);
    const revision = await commitRevision(
      {
        partSlug: part.slug, authorId: user.id, values: old.param_values, message: `Restored ${revisionLabel(old.n)}`, createdAt: new Date(),
        sourceRef: old.source_ref, sourceText: await sourceText(db, old.source_ref), evaluationId: old.evaluation_id, digest: old.geometry_digest,
        tape: { copyFrom: old.id }, restoredFrom: old.id,
      },
      ifMatch as string,
    );
    return createdReply(revision);
  });
}

async function fork(ctx: Ctx): Promise<Reply> {
  const { user, part, revision: origin } = await ownedRevision(ctx, ctx.params.id);
  return idempotent(ctx, user, async () => {
    const ifMatch = ctx.header("if-match");
    await requireCurrentHead(db, part.slug, ifMatch);
    ctx.checkNumbers();
    const model = modelOf(await sourceText(db, origin.source_ref));
    const operation = ctx.json().operation;
    if (typeof operation !== "number" || !Number.isInteger(operation) || operation < model.bodyIndex || operation >= model.tape.length) {
      throw invalid({ operation: "Fork from the body operation or later." });
    }
    const source = forkSource(model, operation);
    const prepared = await prepareRevision({ partSlug: part.slug, sourceText: source, values: origin.param_values, authorId: user.id });
    const revision = await commitRevision(
      {
        ...prepared, partSlug: part.slug, authorId: user.id, values: origin.param_values, createdAt: new Date(),
        message: `Forked ${revisionLabel(origin.n)} at operation ${operation}`, forkedFrom: { revisionId: origin.id, operation },
      },
      ifMatch as string,
    );
    return createdReply(revision);
  });
}

async function publish(ctx: Ctx): Promise<Reply> {
  const user = await ctx.requireUser();
  return idempotent(ctx, user, async () => {
    ctx.checkNumbers();
    const { title, category, visibility, source } = ctx.json();
    const errors: Record<string, string> = {};
    const name = boundedText(title, TITLE_MAX);
    if (name === null) errors.title = boundedMessage(TITLE_MAX);
    if (typeof category !== "string" || !CATEGORIES.some((c) => c.slug === category)) errors.category = "Choose a category.";
    if (visibility !== "public" && visibility !== "private") errors.visibility = "Choose public or private.";
    const text = typeof source === "string" ? source : "";
    const parsed = parseTine(text);
    if (!parsed.ok) errors.source = `Line ${parsed.line}: ${parsed.reason}`;
    if (name === null || !parsed.ok || Object.keys(errors).length > 0) throw invalid(errors);
    const slug = await freshSlug(name);
    try {
      const first = await createPart({
        slug, title: name, category: category as string, visibility: visibility as "public" | "private", ownerId: user.id,
        sourceText: text, values: {}, message: "First version", createdAt: new Date(),
      });
      return newPartReply(slug, first);
    } catch (error) {
      if (error instanceof ApiError && error.code === "evaluation_failed") throw invalid({ source: `Line 1: ${error.message}` });
      throw error;
    }
  });
}

async function listRevisions(ctx: Ctx): Promise<Reply> {
  const part = await readablePart(ctx, ctx.params.slug);
  const rows = await db.rows<RevisionRow>("SELECT * FROM revisions WHERE part_slug = $1 ORDER BY n DESC", [part.slug]);
  return jsonReply(200, { revisions: rows.map(revisionJson) }, { ETag: etagOf(part.headId) });
}

export const revisionRoutes: Route[] = [
  get("/api/parts/:slug/revisions", listRevisions),
  post("/api/parts/:slug/revisions", save, { outage: "save" }),
  post("/api/parts/:slug/copies", copy, { outage: "save" }),
  post("/api/parts/:slug/revisions/:id/restore", restore, { outage: "save" }),
  post("/api/revisions/:id/fork", fork, { outage: "save" }),
  post("/api/parts", publish, { outage: "save" }),
];
