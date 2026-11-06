import { randomUUID } from 'node:crypto';
import { db, type Queryable } from '../db.js';
import { ApiError, fail, FIELD_MESSAGES } from '../errors.js';
import { emitItem, emitJob, emitPlan, emitRoom, jobWrite } from '../events.js';
import {
  body,
  parseMultipart,
  requirePart,
  requireAccount,
  route,
  sendBytes,
  sendJson,
  type Ctx,
  type Route,
} from '../http.js';
import { requireJob, requireOpenJob, requireRole, requireUuid } from '../jobctx.js';
import { currentRevision, projectJob } from '../jobview.js';
import { intakeImage } from '../imageintake.js';
import {
  loadItems,
  loadRooms,
  projectRoom,
  roomCounts,
  roomForPin,
  type RoomRecord,
} from '../model.js';
import {
  checkOutlineShape,
  outlinesOverlap,
  readExactCoordinate,
  readOutline,
  type Outline,
  type UPoint,
} from '../core/geometry.js';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  isCollinear,
  makeTransform,
  type PlanTransform,
  type ReferencePair,
  withinPlan,
} from '../core/transform.js';
import { getObject, putObject, StorageUnavailable } from '../services/objectstore.js';
import { writeItem } from '../itemcore.js';

function transformPairs(transform: PlanTransform): ReferencePair[] {
  return transform.old.map((old, index) => ({ old, new: transform.next[index] }));
}

export async function transformsSince(
  tx: Queryable,
  jobId: string,
  fromRevision: number,
): Promise<PlanTransform[]> {
  const { rows } = await tx.query(
    `select revision, reference_points from plan_revisions
      where job_id = $1 and revision > $2 order by revision`,
    [jobId, fromRevision],
  );
  const out: PlanTransform[] = [];
  for (const row of rows) {
    const pairs = row.reference_points as ReferencePair[] | null;
    out.push(pairs === null ? IDENTITY_TRANSFORM : makeTransform(pairs)!);
  }
  return out;
}

export function mapThrough(transforms: PlanTransform[], pin: UPoint): UPoint {
  let point = pin;
  for (const transform of transforms) point = applyTransform(transform, point);
  return point;
}

async function storeRevision(
  jobId: string,
  image: ReturnType<typeof intakeImage>,
): Promise<{ key: string }> {
  const key = `jobs/${jobId}/plan/${randomUUID()}.${image.extension}`;
  await putObject(key, image.data, image.contentType);
  return { key };
}

function readReferencePairs(value: unknown): ReferencePair[] | 'shape' | 'collinear' {
  if (!Array.isArray(value) || value.length !== 3) return 'shape';
  const pairs: ReferencePair[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return 'shape';
    const record = entry as Record<string, unknown>;
    const oldPoint = record.old as Record<string, unknown> | undefined;
    const newPoint = record.new as Record<string, unknown> | undefined;
    if (!oldPoint || !newPoint) return 'shape';
    const ox = readExactCoordinate(oldPoint.x);
    const oy = readExactCoordinate(oldPoint.y);
    const nx = readExactCoordinate(newPoint.x);
    const ny = readExactCoordinate(newPoint.y);
    if (ox === null || oy === null || nx === null || ny === null) return 'shape';
    pairs.push({ old: { x: ox, y: oy }, new: { x: nx, y: ny } });
  }
  if (isCollinear([pairs[0].old, pairs[1].old, pairs[2].old])) return 'collinear';
  return pairs;
}

function parseJsonPart(text: string, field: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('validation', { fields: { [field]: 'Send this part as JSON.' } });
  }
}

/** The one outline gate: shape rules first, then overlap against every other room. */
export function checkOutlineAgainst(
  outline: Outline,
  others: Outline[],
  field: string,
): void {
  const shape = checkOutlineShape(outline);
  if (shape !== null) {
    throw new ApiError('validation', {
      fields: { [field]: 'Give 4 to 12 corners that make a rectilinear room.' },
    });
  }
  for (const other of others) {
    if (outlinesOverlap(outline, other)) {
      throw new ApiError('validation', { fields: { [field]: FIELD_MESSAGES.overlap } });
    }
  }
}

export const planRoutes: Route[] = [
  route('GET', '/api/jobs/:jobId/rooms', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const rooms = await loadRooms(db, jobCtx.job.id);
    const items = await loadItems(db, jobCtx.job.id);
    sendJson(ctx.res, 200, {
      rooms: rooms.map((room) => projectRoom(room, roomCounts(items, jobCtx.viewer, room.id))),
    });
  }),

  route('POST', '/api/jobs/:jobId/rooms', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner']);
    requireOpenJob(jobCtx);
    const raw = body(ctx);
    const name = raw.name;
    const fields: Record<string, string> = {};
    if (typeof name !== 'string' || name.trim().length < 1 || name.length > 60) {
      fields.name = 'Give the room a name of 1 to 60 characters.';
    }
    const parsed = readOutline(raw.outline);
    if ('problem' in parsed) {
      fields.outline = 'Give 4 to 12 corners that make a rectilinear room.';
    }
    if (Object.keys(fields).length > 0) throw new ApiError('validation', { fields });
    const outline = (parsed as { outline: Outline }).outline;

    const room = await jobWrite(jobCtx.job.id, async (tx) => {
      const rooms = await loadRooms(tx, jobCtx.job.id);
      if (rooms.some((other) => other.name.toLowerCase() === (name as string).toLowerCase())) {
        throw new ApiError('validation', { fields: { name: 'That room name is already used.' } });
      }
      checkOutlineAgainst(outline, rooms.map((other) => other.outline), 'outline');
      const id = randomUUID();
      const seq = await tx.query(
        `update jobs set room_seq = room_seq + 1 where id = $1 returning room_seq`,
        [jobCtx.job.id],
      );
      await tx.query(
        `insert into rooms (id, job_id, name, outline, position, created_at)
         values ($1, $2, $3, $4, $5, now())`,
        [id, jobCtx.job.id, name, JSON.stringify(outline), seq.rows[0].room_seq],
      );
      await emitRoom(tx, jobCtx.job.id, id);
      const fresh = await loadRooms(tx, jobCtx.job.id);
      return fresh.find((candidate) => candidate.id === id)!;
    });
    const items = await loadItems(db, jobCtx.job.id);
    sendJson(ctx.res, 201, projectRoom(room, roomCounts(items, jobCtx.viewer, room.id)));
  }),

  route('PUT', '/api/jobs/:jobId/plan', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner']);
    requireOpenJob(jobCtx);
    const parts = parseMultipart(ctx.rawBody!, ctx.req.headers['content-type'] ?? '');
    const image = intakeImage(requirePart(parts, 'file'));
    let stored: { key: string };
    try {
      stored = await storeRevision(jobCtx.job.id, image);
    } catch (error) {
      if (error instanceof StorageUnavailable) fail('storage_unavailable');
      throw error;
    }
    await jobWrite(jobCtx.job.id, async (tx) => {
      const existing = await currentRevision(tx, jobCtx.job.id);
      const revision = existing === null ? 1 : existing.revision + 1;
      await tx.query(
        `insert into plan_revisions (id, job_id, revision, object_key, content_type,
                                     reference_points, uploaded_by, created_at, moved, needs_review)
         values ($1, $2, $3, $4, $5, $6, $7, now(), 0, 0)`,
        [
          randomUUID(),
          jobCtx.job.id,
          revision,
          stored.key,
          image.contentType,
          revision === 1 ? null : JSON.stringify(transformPairs(IDENTITY_TRANSFORM)),
          account.person.id,
        ],
      );
      await emitPlan(tx, jobCtx.job.id, revision);
      await emitJob(tx, jobCtx.job.id);
    });
    sendJson(ctx.res, 200, await projectJob(db, jobCtx.job, jobCtx.viewer, new Date()));
  }),

  route('GET', '/api/jobs/:jobId/plan', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const plan = await currentRevision(db, jobCtx.job.id);
    if (plan === null) fail('not_found');
    let bytes: Buffer | null;
    try {
      bytes = await getObject(plan.objectKey);
    } catch (error) {
      if (error instanceof StorageUnavailable) fail('storage_unavailable');
      throw error;
    }
    if (bytes === null) fail('storage_unavailable');
    sendBytes(ctx.res, 200, bytes, plan.contentType, 'no-store');
  }),

  route('GET', '/api/jobs/:jobId/plan/revisions', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner', 'lead']);
    const { rows } = await db.query(
      `select r.revision, r.created_at, r.moved, r.needs_review, p.name as uploader,
              coalesce(m.role, 'owner') as uploader_role
         from plan_revisions r
         join people p on p.id = r.uploaded_by
         left join job_members m on m.job_id = r.job_id and m.person_id = r.uploaded_by
        where r.job_id = $1 order by r.revision`,
      [jobCtx.job.id],
    );
    sendJson(ctx.res, 200, {
      revisions: rows.map((row) => ({
        revision: row.revision,
        created_at: (row.created_at as Date).toISOString(),
        uploaded_by: { name: row.uploader, role: row.uploader_role },
        moved: row.moved,
        needs_review: row.needs_review,
      })),
    });
  }),

  route('GET', '/api/jobs/:jobId/plan/revisions/:number', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    const number = Number(ctx.params.number);
    if (!Number.isInteger(number)) fail('not_found');
    const { rows } = await db.query(
      `select object_key, content_type from plan_revisions where job_id = $1 and revision = $2`,
      [jobCtx.job.id, number],
    );
    if (rows.length === 0) fail('not_found');
    requireRole(jobCtx, ['owner', 'lead']);
    let bytes: Buffer | null;
    try {
      bytes = await getObject(rows[0].object_key as string);
    } catch (error) {
      if (error instanceof StorageUnavailable) fail('storage_unavailable');
      throw error;
    }
    if (bytes === null) fail('storage_unavailable');
    sendBytes(ctx.res, 200, bytes, rows[0].content_type as string, 'no-store');
  }),

  route('POST', '/api/jobs/:jobId/plan/revisions', async (ctx: Ctx) => {
    const account = requireAccount(ctx);
    const jobCtx = await requireJob(db, account, ctx.params.jobId);
    requireRole(jobCtx, ['owner']);
    requireOpenJob(jobCtx);
    const existing = await currentRevision(db, jobCtx.job.id);
    if (existing === null) fail('invalid_transition');

    const parts = parseMultipart(ctx.rawBody!, ctx.req.headers['content-type'] ?? '');
    const fields: Record<string, string> = {};

    const pointsPart = parts.find((part) => part.name === 'reference_points');
    let pairs: ReferencePair[] | null = null;
    if (pointsPart === undefined) {
      fields.reference_points = 'Give three reference point pairs.';
    } else {
      const read = readReferencePairs(parseJsonPart(pointsPart.data.toString('utf8'), 'reference_points'));
      if (read === 'collinear') fields.reference_points = FIELD_MESSAGES.collinear;
      else if (read === 'shape') fields.reference_points = 'Give three reference point pairs.';
      else pairs = read;
    }

    const roomsPart = parts.find((part) => part.name === 'rooms');
    const rooms = await loadRooms(db, jobCtx.job.id);
    let outlines: { roomId: string; outline: Outline }[] | null = null;
    if (roomsPart === undefined) {
      fields.rooms = 'Give every room its new corners.';
    } else {
      const read = parseJsonPart(roomsPart.data.toString('utf8'), 'rooms');
      outlines = readRoomOutlines(read, rooms, fields);
    }

    const filePart = parts.find((part) => part.name === 'file');
    if (filePart === undefined) fields.file = 'Choose a plan image.';
    if (Object.keys(fields).length > 0) throw new ApiError('validation', { fields });

    const image = intakeImage(filePart!);
    const transform = makeTransform(pairs!)!;

    let stored: { key: string };
    try {
      stored = await storeRevision(jobCtx.job.id, image);
    } catch (error) {
      if (error instanceof StorageUnavailable) fail('storage_unavailable');
      throw error;
    }

    const outcome = await jobWrite(jobCtx.job.id, async (tx) => {
      const revision = existing.revision + 1;
      await tx.query(
        `insert into plan_revisions (id, job_id, revision, object_key, content_type,
                                     reference_points, uploaded_by, created_at, moved, needs_review)
         values ($1, $2, $3, $4, $5, $6, $7, now(), 0, 0)`,
        [
          randomUUID(),
          jobCtx.job.id,
          revision,
          stored.key,
          image.contentType,
          JSON.stringify(pairs),
          account.person.id,
        ],
      );
      for (const entry of outlines!) {
        await tx.query(`update rooms set outline = $2 where id = $1`, [
          entry.roomId,
          JSON.stringify(entry.outline),
        ]);
      }
      const newRooms = await loadRooms(tx, jobCtx.job.id);
      const items = await loadItems(tx, jobCtx.job.id);
      let moved = 0;
      let needsReview = 0;
      const now = new Date();
      for (const item of items) {
        if (item.pin === null) continue;
        const mapped = applyTransform(transform, item.pin);
        const room = withinPlan(mapped)
          ? roomForPin(newRooms, mapped, null, item.roomId)
          : null;
        if (room === null) {
          await writeItem(
            tx,
            item.id,
            { pin: null, pinStatus: 'needs_review', by: account.person.name },
            now,
          );
          needsReview++;
        } else {
          if (mapped.x !== item.pin.x || mapped.y !== item.pin.y) moved++;
          await writeItem(
            tx,
            item.id,
            { pin: mapped, pinStatus: 'placed', roomId: room.id, by: account.person.name },
            now,
          );
        }
        const fresh = await loadItems(tx, jobCtx.job.id, [item.id]);
        await emitItem(tx, jobCtx.job.id, fresh[0], item.trade);
      }
      await tx.query(
        `update plan_revisions set moved = $3, needs_review = $4
          where job_id = $1 and revision = $2`,
        [jobCtx.job.id, revision, moved, needsReview],
      );
      for (const room of newRooms) await emitRoom(tx, jobCtx.job.id, room.id);
      await emitPlan(tx, jobCtx.job.id, revision);
      await emitJob(tx, jobCtx.job.id);
      return { revision, moved, needsReview };
    });

    sendJson(ctx.res, 201, {
      revision: outcome.revision,
      job: await projectJob(db, jobCtx.job, jobCtx.viewer, new Date()),
      moved: outcome.moved,
      needs_review: outcome.needsReview,
    });
  }),
];

function readRoomOutlines(
  value: unknown,
  rooms: RoomRecord[],
  fields: Record<string, string>,
): { roomId: string; outline: Outline }[] | null {
  if (!Array.isArray(value)) {
    fields.rooms = 'Give every room its new corners.';
    return null;
  }
  const seen = new Set<string>();
  const out: { roomId: string; outline: Outline }[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      fields.rooms = 'Give every room its new corners.';
      return null;
    }
    const record = entry as Record<string, unknown>;
    const roomId = record.room_id;
    if (typeof roomId !== 'string') fail('not_found');
    requireUuid(roomId);
    if (!rooms.some((room) => room.id === roomId)) fail('not_found');
    if (seen.has(roomId)) {
      fields.rooms = 'Name each room exactly once.';
      return null;
    }
    seen.add(roomId);
    const parsed = readOutline(record.outline);
    if ('problem' in parsed) {
      fields.rooms = 'Give 4 to 12 corners that make a rectilinear room.';
      return null;
    }
    out.push({ roomId, outline: parsed.outline });
  }
  if (out.length !== rooms.length) {
    fields.rooms = 'Name each room exactly once.';
    return null;
  }
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (outlinesOverlap(out[i].outline, out[j].outline)) {
        fields.rooms = FIELD_MESSAGES.overlap;
        return null;
      }
    }
  }
  return out;
}
