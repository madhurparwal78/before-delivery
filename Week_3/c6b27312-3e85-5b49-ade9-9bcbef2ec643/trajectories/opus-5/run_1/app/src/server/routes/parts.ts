import { PoolClient } from 'pg';
import { MESSAGE_MAX_CHARS, config } from '../config';
import { query } from '../db';
import { ApiError, invalid, notFound } from '../errors';
import { Ctx, sendBytes, sendJson } from '../http';
import { IdempotentAnswer, withIdempotency } from '../idempotency';
import { readPreflightUsed } from '../bus';
import {
  displayNameOf,
  headRevisionOf,
  likeCount,
  likedBy,
  listRevisions,
  loadPart,
  loadRevision,
  programOfSource,
  revisionJson,
  revisionLabel,
  sourceOfRef,
} from '../records';
import {
  EvaluationFailed,
  HeadMoved,
  commitRevision,
  copySuffix,
  publishOutbox,
  copyTitle,
  createPart,
  evaluateForRevision,
  slugify,
  storeRevisionObjects,
  withEvents,
} from '../parts';
import { getObject, headObject, putObject, storageKeys } from '../storage';
import { ArchiveEntry, buildTar, buildZip, manifestText } from '../archive';
import { CATEGORIES } from '../seed';
import { buildManifest, sourceDefaults } from '../../tine/manifest';
import { TineSourceError } from '../../tine/ast';
import { cmpNumber, cmpText, graphemeLength, normaliseText } from '../../shared/order';
import { checkNumberGrammar, validateValues, valuesFrom } from '../values';
import {
  HeadMovedError,
  checkIfMatch,
  etagOf,
  headMovedAnswer,
  ownedPart,
  readablePart,
  readableRevision,
  requireUser,
  withDownloadStorage,
  withSaveStorage,
} from './helpers';

const PAGE_SIZE = 12;

type GalleryRow = {
  slug: string;
  title: string;
  category: string;
  owner_id: string;
  display_name: string;
  seed_position: number | null;
  created_at: Date;
  likes: string;
  liked: boolean;
  head_id: string | null;
  head_label: number | null;
  head_digest: string | null;
  head_volume: number | null;
  head_bbox: [number, number, number] | null;
};

const SORTS = new Set(['featured', 'liked', 'newest', 'name']);

function sortGallery(rows: GalleryRow[], sort: string): GalleryRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    if (sort === 'featured') {
      const aSeeded = a.seed_position !== null;
      const bSeeded = b.seed_position !== null;
      if (aSeeded && bSeeded) {
        const byPosition = cmpNumber(a.seed_position!, b.seed_position!);
        if (byPosition !== 0) return byPosition;
      } else if (aSeeded !== bSeeded) {
        return aSeeded ? -1 : 1;
      } else {
        const byTime = cmpNumber(a.created_at.getTime(), b.created_at.getTime());
        if (byTime !== 0) return byTime;
      }
      return cmpText(a.slug, b.slug);
    }
    if (sort === 'liked') {
      const byLikes = -cmpNumber(Number(a.likes), Number(b.likes));
      if (byLikes !== 0) return byLikes;
      const byTitle = cmpText(a.title, b.title);
      if (byTitle !== 0) return byTitle;
      return cmpText(a.slug, b.slug);
    }
    if (sort === 'newest') {
      const byTime = -cmpNumber(a.created_at.getTime(), b.created_at.getTime());
      if (byTime !== 0) return byTime;
      return cmpText(a.slug, b.slug);
    }
    const byTitle = cmpText(a.title, b.title);
    if (byTitle !== 0) return byTitle;
    return cmpText(a.slug, b.slug);
  });
  return copy;
}

function cursorValue(category: string, sort: string, slug: string): string {
  return Buffer.from(JSON.stringify({ category, sort, slug }), 'utf8').toString('base64url');
}

function readCursor(value: string): { category: string; sort: string; slug: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      category?: unknown;
      sort?: unknown;
      slug?: unknown;
    };
    if (
      typeof parsed.category !== 'string' ||
      typeof parsed.sort !== 'string' ||
      typeof parsed.slug !== 'string'
    ) {
      return null;
    }
    return { category: parsed.category, sort: parsed.sort, slug: parsed.slug };
  } catch {
    return null;
  }
}

export async function listParts(ctx: Ctx): Promise<void> {
  const category = ctx.url.searchParams.get('category');
  const sort = ctx.url.searchParams.get('sort') ?? 'featured';
  const cursor = ctx.url.searchParams.get('cursor');
  const PAGE_ERROR = 'Start again from the first page.';
  if (category !== null && !CATEGORIES.some((entry) => entry.slug === category)) {
    throw invalid({ category: PAGE_ERROR });
  }
  if (!SORTS.has(sort)) throw invalid({ sort: PAGE_ERROR });

  const result = await query<GalleryRow>(
    `select p.slug, p.title, p.category, p.owner_id, u.display_name, p.seed_position, p.created_at,
            (select count(*)::text from likes l where l.part_slug = p.slug) as likes,
            ($1::text is not null and exists (select 1 from likes l2 where l2.part_slug = p.slug and l2.user_id = $1)) as liked,
            r.id as head_id, r.label_number as head_label, r.geometry_digest as head_digest,
            r.volume as head_volume, r.bbox as head_bbox
       from parts p
       join users u on u.id = p.owner_id
       left join revisions r on r.id = p.head_revision_id
      where p.visibility = 'public' and p.listed`,
    [ctx.user ? ctx.user.id : null],
  );

  const everything = result.rows;
  const categories = [
    { slug: 'all', name: 'All parts', count: everything.length },
    ...CATEGORIES.map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      count: everything.filter((row) => row.category === entry.slug).length,
    })),
  ];

  const filtered = category === null ? everything : everything.filter((row) => row.category === category);
  const sorted = sortGallery(filtered, sort);

  let start = 0;
  if (cursor !== null) {
    const parsed = readCursor(cursor);
    if (!parsed || parsed.sort !== sort || parsed.category !== (category ?? 'all')) {
      throw invalid({ cursor: PAGE_ERROR });
    }
    const index = sorted.findIndex((row) => row.slug === parsed.slug);
    if (index === -1) throw invalid({ cursor: PAGE_ERROR });
    start = index + 1;
  }

  const page = sorted.slice(start, start + PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor =
    last && start + PAGE_SIZE < sorted.length ? cursorValue(category ?? 'all', sort, last.slug) : null;

  sendJson(ctx, 200, {
    parts: page.map((row) => ({
      slug: row.slug,
      title: row.title,
      category: row.category,
      author: { id: row.owner_id, displayName: row.display_name },
      likes: Number(row.likes),
      liked: row.liked,
      createdAt: row.created_at.toISOString(),
      head:
        row.head_id === null
          ? null
          : {
              id: row.head_id,
              label: revisionLabel(row.head_label!),
              geometryDigest: row.head_digest,
              volume: row.head_volume,
              bbox: row.head_bbox,
            },
    })),
    nextCursor,
    categories,
    total: sorted.length,
  });
}

export async function getPart(ctx: Ctx): Promise<void> {
  const part = await readablePart(ctx, ctx.params.slug);
  const head = await headRevisionOf(part.slug);
  const requested = ctx.url.searchParams.get('revision');
  let revision = head;
  if (requested !== null) {
    const named = await loadRevision(requested);
    if (!named || named.part_slug !== part.slug) throw notFound();
    revision = named;
  }
  if (!revision) throw notFound();
  const source = await sourceOfRef(revision.source_ref);
  const program = programOfSource(source);
  const manifest = buildManifest(program, revision.values_json);
  const used = ctx.user ? 0 : await readPreflightUsed(ctx.visitorId);
  sendJson(
    ctx,
    200,
    {
      slug: part.slug,
      title: part.title,
      category: part.category,
      visibility: part.visibility,
      owner: { id: part.owner_id, displayName: await displayNameOf(part.owner_id) },
      likes: await likeCount(part.slug),
      liked: await likedBy(part.slug, ctx.user),
      headRevisionId: head?.id ?? null,
      revision: revisionJson(revision),
      source,
      manifest,
      preflightLeft: ctx.user ? null : Math.max(0, config.preflightSignedOutLimit - used),
    },
    { ETag: etagOf(head?.id ?? null) },
  );
}

export async function getRevisions(ctx: Ctx): Promise<void> {
  const part = await readablePart(ctx, ctx.params.slug);
  const head = await headRevisionOf(part.slug);
  const revisions = await listRevisions(part.slug);
  sendJson(
    ctx,
    200,
    { revisions: revisions.map(revisionJson) },
    { ETag: etagOf(head?.id ?? null) },
  );
}

function checkMessage(value: unknown): string {
  const message = typeof value === 'string' ? normaliseText(value) : '';
  if (graphemeLength(message) > MESSAGE_MAX_CHARS) {
    throw invalid({ message: `Use 1 to ${MESSAGE_MAX_CHARS} characters.` });
  }
  return message;
}

export async function publishPart(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const answer = await withIdempotency(ctx, async () => {
    checkNumberGrammar(ctx.raw, null);
    const title = typeof ctx.body.title === 'string' ? normaliseText(ctx.body.title.trim()) : '';
    const category = typeof ctx.body.category === 'string' ? ctx.body.category : '';
    const visibility = ctx.body.visibility === 'private' ? 'private' : 'public';
    const source = typeof ctx.body.source === 'string' ? ctx.body.source : '';
    const errors: Record<string, string> = {};
    if (graphemeLength(title) < 1 || graphemeLength(title) > 80) errors.title = 'Use 1 to 80 characters.';
    if (!CATEGORIES.some((entry) => entry.slug === category)) {
      errors.category = `Choose one of ${CATEGORIES.map((entry) => entry.slug).join(', ')}.`;
    }
    if (ctx.body.visibility !== 'public' && ctx.body.visibility !== 'private') {
      errors.visibility = 'Choose one of public, private.';
    }
    let program;
    try {
      program = programOfSource(source);
    } catch (error) {
      if (error instanceof TineSourceError) errors.source = error.message;
      else throw error;
    }
    if (Object.keys(errors).length > 0 || !program) throw invalid(errors);

    const values = sourceDefaults(program);
    let evaluated;
    try {
      evaluated = evaluateForRevision(program, values);
    } catch (error) {
      if (error instanceof EvaluationFailed) throw invalid({ source: String(error.body.message) });
      throw error;
    }

    const sourceRef = await withSaveStorage(() => storeRevisionObjects(source, evaluated));

    let slug = slugify(title);
    if (await loadPart(slug)) slug = `${slug}-${copySuffix()}`;

    const created = await withEvents(async (client) =>
      createPart(client, {
        slug,
        title,
        category,
        visibility,
        ownerId: user.id,
        createdAt: new Date(),
      }),
    );

    const result = await commitRevision({
      part: created,
      authorId: user.id,
      authorDisplayName: user.displayName,
      values,
      message: 'First version',
      sourceRef,
      source,
      digest: evaluated.digest,
      volume: evaluated.volume,
      bbox: evaluated.bbox,
      faces: evaluated.faces,
      tape: evaluated.tape,
      evaluationId: evaluated.evaluationId,
      evaluated,
    });
    await publishOutbox(result.events);
    return {
      status: 201,
      body: { slug, revision: revisionJson(result.revision) },
      location: `/api/parts/${slug}`,
      etag: etagOf(result.revision.id),
    } satisfies IdempotentAnswer;
  });
  sendAnswer(ctx, answer);
}

function sendAnswer(ctx: Ctx, answer: IdempotentAnswer): void {
  const headers: Record<string, string> = {};
  if (answer.location) headers.Location = answer.location;
  if (answer.etag) headers.ETag = answer.etag;
  const text = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body);
  ctx.res.writeHead(answer.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...headers,
  });
  ctx.res.end(text);
}

async function evaluatedFromBody(
  ctx: Ctx,
  source: string,
  values: Record<string, unknown>,
): Promise<{ values: ReturnType<typeof validateValues>; evaluated: ReturnType<typeof evaluateForRevision> }> {
  const program = programOfSource(source);
  const manifest = buildManifest(program, {});
  checkNumberGrammar(ctx.raw, manifest);
  const checked = validateValues(manifest, values);
  return { values: checked, evaluated: evaluateForRevision(program, checked) };
}

export async function saveRevision(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const part = await readablePart(ctx, ctx.params.slug);
  ownedPart(part, user);
  const answer = await withIdempotency(ctx, async () => {
    const head = await headRevisionOf(part.slug);
    try {
      checkIfMatch(ctx, head?.id ?? null);
    } catch (error) {
      if (error instanceof HeadMovedError) throw await headMovedAnswer(part.slug);
      throw error;
    }
    const message = checkMessage(ctx.body.message);
    const source = await sourceOfRef(head!.source_ref);
    const { values, evaluated } = await evaluatedFromBody(ctx, source, valuesFrom(ctx.body));
    const sourceRef = await withSaveStorage(() => storeRevisionObjects(source, evaluated));
    try {
      const result = await commitRevision({
        part,
        authorId: user.id,
        authorDisplayName: user.displayName,
        values,
        message,
        sourceRef,
        source,
        digest: evaluated.digest,
        volume: evaluated.volume,
        bbox: evaluated.bbox,
        faces: evaluated.faces,
        tape: evaluated.tape,
        evaluationId: evaluated.evaluationId,
        evaluated,
        expectedHeadId: head?.id ?? null,
      });
      await publishOutbox(result.events);
      return {
        status: 201,
        body: revisionJson(result.revision),
        location: `/api/parts/${part.slug}?revision=${result.revision.id}`,
        etag: etagOf(result.revision.id),
      } satisfies IdempotentAnswer;
    } catch (error) {
      if (error instanceof HeadMoved) throw await headMovedAnswer(part.slug);
      throw error;
    }
  });
  sendAnswer(ctx, answer);
}

export async function copyPart(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const part = await readablePart(ctx, ctx.params.slug);
  const answer = await withIdempotency(ctx, async () => {
    const head = await headRevisionOf(part.slug);
    const message = checkMessage(ctx.body.message);
    const source = await sourceOfRef(head!.source_ref);
    const { values, evaluated } = await evaluatedFromBody(ctx, source, valuesFrom(ctx.body));
    const sourceRef = await withSaveStorage(() => storeRevisionObjects(source, evaluated));
    const slug = `${part.slug}-${copySuffix()}`;
    const created = await withEvents(async (client) =>
      createPart(client, {
        slug,
        title: copyTitle(part.title),
        category: part.category,
        visibility: 'private',
        ownerId: user.id,
        createdAt: new Date(),
      }),
    );
    const result = await commitRevision({
      part: created,
      authorId: user.id,
      authorDisplayName: user.displayName,
      values,
      message,
      sourceRef,
      source,
      digest: evaluated.digest,
      volume: evaluated.volume,
      bbox: evaluated.bbox,
      faces: evaluated.faces,
      tape: evaluated.tape,
      evaluationId: evaluated.evaluationId,
      evaluated,
    });
    await publishOutbox(result.events);
    return {
      status: 201,
      body: { slug, revision: revisionJson(result.revision) },
      location: `/api/parts/${slug}`,
      etag: etagOf(result.revision.id),
    } satisfies IdempotentAnswer;
  });
  sendAnswer(ctx, answer);
}

export async function restoreRevision(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const part = await readablePart(ctx, ctx.params.slug);
  ownedPart(part, user);
  const target = await loadRevision(ctx.params.id);
  if (!target || target.part_slug !== part.slug) throw notFound();
  const answer = await withIdempotency(ctx, async () => {
    const head = await headRevisionOf(part.slug);
    try {
      checkIfMatch(ctx, head?.id ?? null);
    } catch (error) {
      if (error instanceof HeadMovedError) throw await headMovedAnswer(part.slug);
      throw error;
    }
    if (head!.id === target.id) {
      throw new ApiError(409, {
        error: 'already_head',
        message: `${revisionLabel(target.label_number)} is already the latest revision.`,
      });
    }
    await withSaveStorage(async () => {
      const present = await headObject(storageKeys.solid(target.geometry_digest));
      if (!present) throw new ApiError(503, { error: 'storage_unavailable', message: '' });
    });
    const tape = await query<{ operations: unknown[] }>(
      'select operations from tapes where revision_id = $1',
      [target.id],
    );
    const source = await sourceOfRef(target.source_ref);
    try {
      const result = await commitRevision({
        part,
        authorId: user.id,
        authorDisplayName: user.displayName,
        values: target.values_json,
        message: `Restored ${revisionLabel(target.label_number)}`,
        sourceRef: target.source_ref,
        source,
        digest: target.geometry_digest,
        volume: target.volume,
        bbox: target.bbox,
        faces: target.faces,
        tape: [],
        tapeOperations: tape.rows[0]?.operations ?? [],
        evaluationId: target.evaluation_id,
        evaluated: null,
        restoredFrom: target.id,
        expectedHeadId: head?.id ?? null,
      });
      await publishOutbox(result.events);
      return {
        status: 201,
        body: revisionJson(result.revision),
        location: `/api/parts/${part.slug}?revision=${result.revision.id}`,
        etag: etagOf(result.revision.id),
      } satisfies IdempotentAnswer;
    } catch (error) {
      if (error instanceof HeadMoved) throw await headMovedAnswer(part.slug);
      throw error;
    }
  });
  sendAnswer(ctx, answer);
}

export async function forkRevision(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const { revision, part } = await readableRevision(ctx, ctx.params.id);
  ownedPart(part, user);
  const answer = await withIdempotency(ctx, async () => {
    const head = await headRevisionOf(part.slug);
    try {
      checkIfMatch(ctx, head?.id ?? null);
    } catch (error) {
      if (error instanceof HeadMovedError) throw await headMovedAnswer(part.slug);
      throw error;
    }
    checkNumberGrammar(ctx.raw, null);
    const operation = ctx.body.operation;
    const source = await sourceOfRef(revision.source_ref);
    const program = programOfSource(source);
    const { buildTape, truncateSource } = await import('../../tine/evaluate');
    const tape = buildTape(program, revision.values_json);
    const bodyIndex = tape.findIndex((step) => step.kind === 'body');
    if (
      typeof operation !== 'number' ||
      !Number.isInteger(operation) ||
      operation < bodyIndex ||
      operation >= tape.length
    ) {
      throw invalid({ operation: 'Fork from the body operation or later.' });
    }
    const forkedSource = truncateSource(source, program, operation);
    const forkedProgram = programOfSource(forkedSource);
    const evaluated = evaluateForRevision(forkedProgram, revision.values_json);
    const sourceRef = await withSaveStorage(() => storeRevisionObjects(forkedSource, evaluated));
    try {
      const result = await commitRevision({
        part,
        authorId: user.id,
        authorDisplayName: user.displayName,
        values: revision.values_json,
        message: `Forked ${revisionLabel(revision.label_number)} at operation ${operation}`,
        sourceRef,
        source: forkedSource,
        digest: evaluated.digest,
        volume: evaluated.volume,
        bbox: evaluated.bbox,
        faces: evaluated.faces,
        tape: evaluated.tape,
        evaluationId: evaluated.evaluationId,
        evaluated,
        forkedFrom: { revisionId: revision.id, operation },
        expectedHeadId: head?.id ?? null,
      });
      await publishOutbox(result.events);
      return {
        status: 201,
        body: revisionJson(result.revision),
        location: `/api/parts/${part.slug}?revision=${result.revision.id}`,
        etag: etagOf(result.revision.id),
      } satisfies IdempotentAnswer;
    } catch (error) {
      if (error instanceof HeadMoved) throw await headMovedAnswer(part.slug);
      throw error;
    }
  });
  sendAnswer(ctx, answer);
}

export async function getTape(ctx: Ctx): Promise<void> {
  const { revision } = await readableRevision(ctx, ctx.params.id);
  const tape = await query<{ operations: unknown[] }>(
    'select operations from tapes where revision_id = $1',
    [revision.id],
  );
  const operations = tape.rows[0]?.operations ?? [];
  const report = await query<{
    id: string;
    part_slug: string;
    process: string;
    values_json: unknown;
    geometry_digest: string;
    status: string;
    message: string | null;
    findings: unknown;
    cost_bands: unknown;
    confidence: string | null;
    created_at: Date;
  }>(
    `select * from preflight_reports where geometry_digest = $1 and status = 'complete'
     order by created_at desc limit 1`,
    [revision.geometry_digest],
  );
  const stored = report.rows[0];
  sendJson(ctx, 200, {
    revisionId: revision.id,
    n: Math.max(0, operations.length - 1),
    operations,
    preflight: stored
      ? {
          id: stored.id,
          partSlug: stored.part_slug,
          process: stored.process,
          values: stored.values_json,
          geometryDigest: stored.geometry_digest,
          status: stored.status,
          message: stored.message,
          findings: stored.findings,
          costBands: stored.cost_bands,
          confidence: stored.confidence,
          createdAt: stored.created_at.toISOString(),
        }
      : null,
  });
}

export async function getSolid(ctx: Ctx): Promise<void> {
  const bytes = await withDownloadStorage(() => getObject(storageKeys.solid(ctx.params.digest)));
  if (!bytes) throw notFound();
  sendBytes(ctx, 200, bytes, 'application/json');
}

export async function getThumbnail(ctx: Ctx): Promise<void> {
  const bytes = await withDownloadStorage(() => getObject(storageKeys.thumbnail(ctx.params.digest)));
  if (!bytes) throw notFound();
  sendBytes(ctx, 200, bytes, 'image/svg+xml');
}

/** Each archive is built on first download from the stored objects, stored, then served. */
export async function getArchive(ctx: Ctx): Promise<void> {
  const format = ctx.params.format === 'tar' ? 'tar' : 'zip';
  const { revision, part } = await readableRevision(ctx, ctx.params.id);
  const label = revisionLabel(revision.label_number);
  const filename = `${part.slug}-${label}.${format}`;
  const bytes = await withDownloadStorage(async () => {
    const stored = await getObject(storageKeys.archive(revision.id, format));
    if (stored) return stored;
    const source = await getObject(revision.source_ref);
    if (!source) throw notFound();
    const tape = await query<{ operations: { digest: string }[] }>(
      'select operations from tapes where revision_id = $1',
      [revision.id],
    );
    const digests = new Set<string>([revision.geometry_digest]);
    for (const operation of tape.rows[0]?.operations ?? []) digests.add(operation.digest);
    const folder = `${part.slug}-${label}`;
    const entries: ArchiveEntry[] = [
      { path: `${folder}/part.tine`, bytes: source },
      {
        path: `${folder}/revision.json`,
        bytes: Buffer.from(JSON.stringify(revisionJson(revision)), 'utf8'),
      },
    ];
    for (const digest of digests) {
      const solid = await getObject(storageKeys.solid(digest));
      if (!solid) throw notFound();
      entries.push({ path: `${folder}/solids/${digest}.json`, bytes: solid });
    }
    entries.push({
      path: `${folder}/manifest.txt`,
      bytes: Buffer.from(manifestText(revision.volume, revision.bbox, entries), 'utf8'),
    });
    const built = format === 'zip' ? buildZip(entries) : buildTar(entries);
    await putObject(
      storageKeys.archive(revision.id, format),
      built,
      format === 'zip' ? 'application/zip' : 'application/x-tar',
    );
    return built;
  });
  sendBytes(ctx, 200, bytes, format === 'zip' ? 'application/zip' : 'application/x-tar', {
    'content-disposition': `attachment; filename="${filename}"`,
  });
}

async function setLike(ctx: Ctx, liked: boolean): Promise<void> {
  const user = requireUser(ctx);
  const part = await readablePart(ctx, ctx.params.slug);
  const likes = await withEvents(async (client: PoolClient, emit) => {
    if (liked) {
      await client.query(
        'insert into likes (part_slug, user_id, created_at) values ($1, $2, now()) on conflict do nothing',
        [part.slug, user.id],
      );
    } else {
      await client.query('delete from likes where part_slug = $1 and user_id = $2', [part.slug, user.id]);
    }
    const count = await client.query<{ count: string }>(
      'select count(*)::text as count from likes where part_slug = $1',
      [part.slug],
    );
    const total = Number(count.rows[0].count);
    await emit({
      slug: part.slug,
      roomId: null,
      type: 'like',
      data: { type: 'like', partSlug: part.slug, likes: total },
    });
    return total;
  });
  sendJson(ctx, 200, { liked, likes });
}

export const likePart = (ctx: Ctx): Promise<void> => setLike(ctx, true);
export const unlikePart = (ctx: Ctx): Promise<void> => setLike(ctx, false);

export async function dashboard(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const parts = await query<{
    slug: string;
    title: string;
    visibility: string;
    likes: string;
    head_id: string | null;
    head_label: number | null;
    revision_count: string;
    created_at: Date;
  }>(
    `select p.slug, p.title, p.visibility, p.created_at,
            (select count(*)::text from likes l where l.part_slug = p.slug) as likes,
            r.id as head_id, r.label_number as head_label,
            (select count(*)::text from revisions rr where rr.part_slug = p.slug) as revision_count
       from parts p left join revisions r on r.id = p.head_revision_id
      where p.owner_id = $1`,
    [user.id],
  );
  const rooms = await query<{
    id: string;
    title: string;
    part_slug: string;
    state: string;
    required_approvals: number;
    created_at: Date;
    approvals: string;
  }>(
    `select ro.id, ro.title, ro.part_slug, ro.state, ro.required_approvals, ro.created_at,
            (select count(*)::text from approvals a join revisions h on h.id = ro.head_revision_id
              where a.room_id = ro.id and a.geometry_digest = h.geometry_digest) as approvals
       from rooms ro
      where ro.created_by = $1
         or exists (select 1 from room_reviewers rr where rr.room_id = ro.id and rr.email_folded = $2)`,
    [user.id, user.email.toUpperCase().toLowerCase()],
  );
  const liked = await query<{ slug: string; title: string; display_name: string; created_at: Date }>(
    `select p.slug, p.title, u.display_name, l.created_at
       from likes l join parts p on p.slug = l.part_slug join users u on u.id = p.owner_id
      where l.user_id = $1`,
    [user.id],
  );

  sendJson(ctx, 200, {
    parts: [...parts.rows]
      .sort((a, b) => {
        const byTime = -cmpNumber(a.created_at.getTime(), b.created_at.getTime());
        return byTime !== 0 ? byTime : cmpText(a.slug, b.slug);
      })
      .map((row) => ({
        slug: row.slug,
        title: row.title,
        visibility: row.visibility,
        likes: Number(row.likes),
        head: row.head_id === null ? null : { id: row.head_id, label: revisionLabel(row.head_label!) },
        revisionCount: Number(row.revision_count),
      })),
    rooms: [...rooms.rows]
      .sort((a, b) => {
        const byTime = -cmpNumber(a.created_at.getTime(), b.created_at.getTime());
        return byTime !== 0 ? byTime : cmpText(a.id, b.id);
      })
      .map((row) => ({
        id: row.id,
        title: row.title,
        partSlug: row.part_slug,
        state: row.state,
        approvals: Number(row.approvals),
        requiredApprovals: row.required_approvals,
      })),
    liked: [...liked.rows]
      .sort((a, b) => {
        const byTime = -cmpNumber(a.created_at.getTime(), b.created_at.getTime());
        return byTime !== 0 ? byTime : cmpText(a.slug, b.slug);
      })
      .map((row) => ({ slug: row.slug, title: row.title, author: row.display_name })),
  });
}
