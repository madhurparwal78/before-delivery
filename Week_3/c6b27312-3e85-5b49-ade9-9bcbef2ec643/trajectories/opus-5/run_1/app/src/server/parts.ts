import { PoolClient } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { ENGINE_VERSION, config } from './config';
import { transaction } from './db';
import { ApiError, forbidden, storageUnavailable, STORAGE_SAVE_MESSAGE } from './errors';
import { PartRow, RevisionRow, RoomRow, revisionJson, revisionLabel } from './records';
import { headObject, putObject, storageKeys } from './storage';
import { thumbnailSvg } from './thumbnail';
import { TapeStep, buildTape, evaluateProgram } from '../tine/evaluate';
import { geometryDigest, sha256Hex } from '../tine/digest';
import { Solid, solidJson } from '../tine/solid';
import { Values } from '../tine/manifest';
import { TineProgram } from '../tine/ast';
import { roundTo } from '../shared/numbers';
import { publishPartEvent } from './bus';
import { roomJson } from './records';

export type EvaluatedRevision = {
  digest: string;
  volume: number;
  bbox: [number, number, number];
  faces: number;
  solid: Solid;
  tape: TapeStep[];
  evaluationId: string;
};

export class EvaluationFailed extends ApiError {
  constructor(message: string, diagnostics: unknown[]) {
    super(422, { error: 'evaluation_failed', message, diagnostics });
  }
}

/** A save evaluates the values against the parent's source. */
export function evaluateForRevision(program: TineProgram, values: Values): EvaluatedRevision {
  const result = evaluateProgram(program, values);
  if (!result.ok) {
    throw new EvaluationFailed(result.diagnostic.message, [result.diagnostic]);
  }
  const tape = buildTape(program, values);
  return {
    digest: geometryDigest(result.solid),
    volume: roundTo(result.measures.volume, 3),
    bbox: [
      roundTo(result.measures.bbox[0], 3),
      roundTo(result.measures.bbox[1], 3),
      roundTo(result.measures.bbox[2], 3),
    ],
    faces: result.measures.faces,
    solid: result.solid,
    tape,
    evaluationId: randomUUID(),
  };
}

/** Every object a revision needs is written and confirmed present before its row. */
export async function storeRevisionObjects(source: string, evaluated: EvaluatedRevision): Promise<string> {
  const sourceBytes = Buffer.from(source, 'utf8');
  const sourceRef = storageKeys.source(sha256Hex(sourceBytes));
  await putObject(sourceRef, sourceBytes, 'text/plain; charset=utf-8');

  const solids = new Map<string, Solid>();
  solids.set(evaluated.digest, evaluated.solid);
  for (const step of evaluated.tape) solids.set(geometryDigest(step.solid), step.solid);

  for (const [digest, solid] of solids) {
    const bytes = Buffer.from(solidJson(solid), 'utf8');
    await putObject(storageKeys.solid(digest), bytes, 'application/json');
    await putObject(
      storageKeys.thumbnail(digest),
      Buffer.from(thumbnailSvg(solid), 'utf8'),
      'image/svg+xml',
    );
  }

  const confirmed = await Promise.all([
    headObject(sourceRef),
    ...[...solids.keys()].map((digest) => headObject(storageKeys.solid(digest))),
  ]);
  if (confirmed.some((entry) => entry === null)) throw storageUnavailable(STORAGE_SAVE_MESSAGE);
  return sourceRef;
}

export type OutboxDraft = { slug: string; roomId: string | null; type: string; data: unknown };

async function writeOutbox(
  client: PoolClient,
  draft: OutboxDraft,
  createdAt: Date,
): Promise<{ id: string; draft: OutboxDraft }> {
  const result = await client.query<{ id: string }>(
    'insert into outbox (part_slug, room_id, type, payload, created_at) values ($1, $2, $3, $4, $5) returning id::text as id',
    [draft.slug, draft.roomId, draft.type, JSON.stringify(draft.data), createdAt],
  );
  return { id: result.rows[0].id, draft };
}

/** Every live event is written in the same transaction as its change, then relayed. */
export async function withEvents<T>(
  work: (client: PoolClient, emit: (draft: OutboxDraft) => Promise<void>) => Promise<T>,
): Promise<T> {
  const events: { id: string; draft: OutboxDraft }[] = [];
  const result = await transaction(async (client) => {
    const createdAt = new Date();
    return work(client, async (draft) => {
      events.push(await writeOutbox(client, draft, createdAt));
    });
  });
  await publishOutbox(events);
  return result;
}

export async function publishOutbox(rows: { id: string; draft: OutboxDraft }[]): Promise<void> {
  for (const row of rows) {
    await publishPartEvent(row.draft.slug, {
      id: row.id,
      type: row.draft.type,
      roomId: row.draft.roomId,
      data: row.draft.data,
    });
  }
}

async function insertSource(client: PoolClient, ref: string, body: string): Promise<void> {
  await client.query('insert into sources (ref, body) values ($1, $2) on conflict (ref) do nothing', [
    ref,
    body,
  ]);
}

async function insertEvaluation(
  client: PoolClient,
  id: string,
  partSlug: string,
  evaluated: EvaluatedRevision,
  createdAt: Date,
): Promise<void> {
  await client.query(
    `insert into evaluations (id, part_slug, viewer_id, seq, status, engine_version, geometry_digest,
       volume, bbox, faces, solid, diagnostics, started_at, finished_at)
     values ($1, $2, null, 0, 'succeeded', $3, $4, $5, $6, $7, $8, '[]'::jsonb, $9, $9)`,
    [
      id,
      partSlug,
      ENGINE_VERSION,
      evaluated.digest,
      evaluated.volume,
      JSON.stringify(evaluated.bbox),
      evaluated.faces,
      JSON.stringify(evaluated.solid),
      createdAt,
    ],
  );
}

export type RevisionWrite = {
  part: PartRow;
  authorId: string;
  authorDisplayName: string;
  values: Values;
  message: string;
  sourceRef: string;
  source: string;
  digest: string;
  volume: number;
  bbox: [number, number, number];
  faces: number;
  tape: TapeStep[];
  tapeOperations?: unknown[];
  evaluationId: string | null;
  evaluated: EvaluatedRevision | null;
  restoredFrom?: string | null;
  forkedFrom?: { revisionId: string; operation: number } | null;
  expectedHeadId?: string | null;
  createdAt?: Date;
};

export class HeadMoved extends Error {
  constructor(readonly head: RevisionRow) {
    super('head_moved');
  }
}

async function insertRevisionRow(
  client: PoolClient,
  write: RevisionWrite,
  createdAt: Date,
): Promise<RevisionRow> {
  await client.query('select slug from parts where slug = $1 for update', [write.part.slug]);
  const headResult = await client.query<RevisionRow>(
    'select * from revisions where part_slug = $1 order by label_number desc limit 1',
    [write.part.slug],
  );
  const head = headResult.rows[0] ?? null;
  if (write.expectedHeadId !== undefined && (head?.id ?? null) !== write.expectedHeadId) {
    throw new HeadMoved(head!);
  }
  const labelNumber = (head?.label_number ?? 0) + 1;
  const id = randomUUID();
  await insertSource(client, write.sourceRef, write.source);
  if (write.evaluated && write.evaluationId) {
    await insertEvaluation(client, write.evaluationId, write.part.slug, write.evaluated, createdAt);
  }
  const inserted = await client.query<RevisionRow>(
    `insert into revisions (id, part_slug, label_number, parent_revision_id, author_id, created_at,
       values_json, source_ref, evaluation_id, geometry_digest, message, restored_from,
       forked_from_revision_id, forked_from_operation, volume, bbox, faces)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,
    [
      id,
      write.part.slug,
      labelNumber,
      head?.id ?? null,
      write.authorId,
      createdAt,
      JSON.stringify(write.values),
      write.sourceRef,
      write.evaluationId,
      write.digest,
      write.message,
      write.restoredFrom ?? null,
      write.forkedFrom?.revisionId ?? null,
      write.forkedFrom?.operation ?? null,
      write.volume,
      JSON.stringify(write.bbox),
      write.faces,
    ],
  );
  const revision = inserted.rows[0];
  await client.query('insert into tapes (revision_id, operations) values ($1, $2)', [
    revision.id,
    JSON.stringify(
      write.tapeOperations ??
        write.tape.map((step) => ({
          index: step.index,
          kind: step.kind,
          op: step.op,
          line: step.line,
          digest: geometryDigest(step.solid),
          volume: step.volume,
          delta: step.delta,
          bbox: step.bbox,
        })),
    ),
  ]);
  await client.query('update parts set head_revision_id = $1 where slug = $2', [
    revision.id,
    write.part.slug,
  ]);
  return revision;
}

type RoomEffect = { room: RoomRow; reason: 'reset' | 'carried' | 'matched'; countedBefore: number; countedAfter: number };

/** A new head moves every room on the part and follows the head's geometry. */
async function applyNewHead(
  client: PoolClient,
  slug: string,
  revision: RevisionRow,
  previousDigest: string | null,
): Promise<RoomEffect[]> {
  const rooms = await client.query<RoomRow>('select * from rooms where part_slug = $1', [slug]);
  const effects: RoomEffect[] = [];
  for (const room of rooms.rows) {
    const before = previousDigest
      ? await client.query<{ count: string }>(
          'select count(*)::text as count from approvals where room_id = $1 and geometry_digest = $2',
          [room.id, previousDigest],
        )
      : null;
    const after = await client.query<{ count: string }>(
      'select count(*)::text as count from approvals where room_id = $1 and geometry_digest = $2',
      [room.id, revision.geometry_digest],
    );
    const countedBefore = before ? Number(before.rows[0].count) : 0;
    const countedAfter = Number(after.rows[0].count);
    const state =
      room.state === 'closed' ? 'closed' : countedAfter >= room.required_approvals ? 'approved' : 'open';
    const updated = await client.query<RoomRow>(
      'update rooms set head_revision_id = $1, state = $2 where id = $3 returning *',
      [revision.id, state, room.id],
    );
    const sameDigest = previousDigest === revision.geometry_digest;
    const reason: RoomEffect['reason'] | null = sameDigest
      ? 'carried'
      : countedAfter > 0
        ? 'matched'
        : countedBefore > 0
          ? 'reset'
          : null;
    if (reason) effects.push({ room: updated.rows[0], reason, countedBefore, countedAfter });
  }
  return effects;
}

export type RevisionResult = { revision: RevisionRow; events: { id: string; draft: OutboxDraft }[] };

/** The revision row, its outbox event and its room effects in one transaction. */
export async function commitRevision(write: RevisionWrite): Promise<RevisionResult> {
  const createdAt = write.createdAt ?? new Date();
  return transaction(async (client) => {
    const previous = await client.query<{ geometry_digest: string }>(
      'select geometry_digest from revisions where part_slug = $1 order by label_number desc limit 1',
      [write.part.slug],
    );
    const previousDigest = previous.rows[0]?.geometry_digest ?? null;
    const revision = await insertRevisionRow(client, write, createdAt);
    const events: { id: string; draft: OutboxDraft }[] = [];
    events.push(
      await writeOutbox(
        client,
        {
          slug: write.part.slug,
          roomId: null,
          type: 'revision',
          data: {
            type: 'revision',
            revision: revisionJson(revision),
            authorDisplayName: write.authorDisplayName,
            digestChanged: previousDigest !== revision.geometry_digest,
          },
        },
        createdAt,
      ),
    );
    for (const effect of await applyNewHead(client, write.part.slug, revision, previousDigest)) {
      events.push(
        await writeOutbox(
          client,
          {
            slug: write.part.slug,
            roomId: effect.room.id,
            type: 'approvals',
            data: {
              type: 'approvals',
              room: await roomJson(effect.room, client),
              reason: effect.reason,
              label: revisionLabel(revision.label_number),
              displayName: null,
            },
          },
          createdAt,
        ),
      );
    }
    return { revision, events };
  });
}

export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base.length > 0 ? base : 'part';
}

export function copySuffix(): string {
  return randomBytes(3).toString('hex');
}

export async function createPart(
  client: PoolClient,
  part: {
    slug: string;
    title: string;
    category: string;
    visibility: string;
    ownerId: string;
    createdAt: Date;
  },
): Promise<PartRow> {
  const result = await client.query<PartRow>(
    `insert into parts (slug, title, category, visibility, owner_id, seed_position, created_at, head_revision_id)
     values ($1,$2,$3,$4,$5,null,$6,null) returning *`,
    [part.slug, part.title, part.category, part.visibility, part.ownerId, part.createdAt],
  );
  return result.rows[0];
}

export function requireOwner(part: PartRow, userId: string): void {
  if (part.owner_id !== userId) throw forbidden();
}

export const COPY_TITLE_SUFFIX = ' (my configuration)';

export function copyTitle(title: string): string {
  return `${title}${COPY_TITLE_SUFFIX}`;
}

export const REQUIRED_APPROVALS = config.requiredApprovals;
