import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { query } from '../db';
import { invalid, notFound } from '../errors';
import { Ctx, sendJson } from '../http';
import { createSession, createUser, findUserByEmail } from '../auth';
import {
  commitRevision,
  createPart,
  evaluateForRevision,
  publishOutbox,
  storeRevisionObjects,
  withEvents,
} from '../parts';
import {
  headRevisionOf,
  loadPart,
  loadRevision,
  programOfSource,
  revisionLabel,
  roomJson,
  sourceOfRef,
} from '../records';
import { SEED_PARTS } from '../seed';
import { buildManifest, sourceDefaults } from '../../tine/manifest';
import { foldEmail, normaliseText } from '../../shared/order';
import { checkNumberGrammar, validateValues } from '../values';
import { evaluationCounts } from '../evaluations';
import { setEvaluatorDelay, publishDropStreams } from '../bus';
import { poseOfBox } from '../../tine/preflight';

type Entry = Record<string, unknown>;

function list(body: Record<string, unknown>, name: string): Entry[] {
  const value = body[name];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid({ [name]: 'Send a list.' });
  return value as Entry[];
}

function textOf(entry: Entry, name: string): string {
  const value = entry[name];
  return typeof value === 'string' ? value : '';
}

export async function gradingSetup(ctx: Ctx): Promise<void> {
  const createdAt = new Date();
  const users: Record<string, { id: string; cookie: string }> = {};
  const parts: Record<string, { slug: string; headRevisionId: string }> = {};
  const revisions: Record<string, { id: string; label: string }> = {};
  const rooms: Record<string, { id: string }> = {};
  const comments: Record<string, { id: string }> = {};
  const userIds: Record<string, string> = {};
  const userEmails: Record<string, string> = {};
  const partSlugs: Record<string, string> = {};

  for (const entry of list(ctx.body, 'users')) {
    const key = textOf(entry, 'key');
    const email = textOf(entry, 'email');
    const existing = await findUserByEmail(email);
    const user =
      existing ??
      (await createUser(
        email,
        textOf(entry, 'password') || 'bench-seed-2026',
        normaliseText(textOf(entry, 'displayName')) || email,
        entry.verified !== false,
        createdAt,
      ));
    const cookie = await createSession(user.id);
    users[key] = { id: user.id, cookie: `tw_session=${cookie}` };
    userIds[key] = user.id;
    userEmails[key] = user.email;
  }

  const ownerIdOf = async (key: string): Promise<string> => {
    if (userIds[key]) return userIds[key];
    const user = await findUserByEmail(key);
    if (!user) throw invalid({ owner: `Unknown user ${key}.` });
    return user.id;
  };

  for (const entry of list(ctx.body, 'parts')) {
    const key = textOf(entry, 'key');
    const from = textOf(entry, 'from');
    const seeded = from ? SEED_PARTS.find((part) => part.slug === from) : undefined;
    if (from && !seeded) throw invalid({ parts: `Unknown seeded part ${from}.` });
    const source = seeded ? seeded.source : textOf(entry, 'source');
    const slug = textOf(entry, 'slug') || `${seeded ? seeded.slug : 'part'}-${randomUUID().slice(0, 6)}`;
    const title = normaliseText(textOf(entry, 'title')) || (seeded ? seeded.title : slug);
    const category = textOf(entry, 'category') || (seeded ? seeded.category : 'hardware');
    const visibility = textOf(entry, 'visibility') || 'public';
    const ownerId = await ownerIdOf(textOf(entry, 'owner'));
    const program = programOfSource(source);
    const values = sourceDefaults(program);
    const evaluated = evaluateForRevision(program, values);
    const sourceRef = await storeRevisionObjects(source, evaluated);
    const part = await withEvents(async (client) =>
      createPart(client, { slug, title, category, visibility, ownerId, createdAt }),
    );
    const result = await commitRevision({
      part,
      authorId: ownerId,
      authorDisplayName: '',
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
      createdAt,
    });
    await publishOutbox(result.events);
    parts[key] = { slug, headRevisionId: result.revision.id };
    partSlugs[key] = slug;
  }

  for (const entry of list(ctx.body, 'revisions')) {
    const key = textOf(entry, 'key');
    const partKey = textOf(entry, 'part');
    const slug = partSlugs[partKey] ?? partKey;
    const part = await loadPart(slug);
    if (!part) throw invalid({ revisions: `Unknown part ${partKey}.` });
    const head = await headRevisionOf(slug);
    if (!head) throw invalid({ revisions: `Part ${slug} has no head.` });
    const authorId = await ownerIdOf(textOf(entry, 'author'));
    const source = await sourceOfRef(head.source_ref);
    const program = programOfSource(source);
    const manifest = buildManifest(program, {});
    const provided = (entry.values ?? {}) as Record<string, unknown>;
    const values = validateValues(manifest, provided);
    const evaluated = evaluateForRevision(program, values);
    const sourceRef = await storeRevisionObjects(source, evaluated);
    const result = await commitRevision({
      part,
      authorId,
      authorDisplayName: '',
      values,
      message: normaliseText(textOf(entry, 'message')),
      sourceRef,
      source,
      digest: evaluated.digest,
      volume: evaluated.volume,
      bbox: evaluated.bbox,
      faces: evaluated.faces,
      tape: evaluated.tape,
      evaluationId: evaluated.evaluationId,
      evaluated,
      createdAt,
    });
    await publishOutbox(result.events);
    if (key) revisions[key] = { id: result.revision.id, label: revisionLabel(result.revision.label_number) };
    if (partSlugs[partKey]) parts[partKey] = { slug, headRevisionId: result.revision.id };
  }

  for (const entry of list(ctx.body, 'rooms')) {
    const key = textOf(entry, 'key');
    const partKey = textOf(entry, 'part');
    const slug = partSlugs[partKey] ?? partKey;
    const part = await loadPart(slug);
    if (!part) throw invalid({ rooms: `Unknown part ${partKey}.` });
    const head = await headRevisionOf(slug);
    if (!head) throw invalid({ rooms: `Part ${slug} has no head.` });
    const ownerId = await ownerIdOf(textOf(entry, 'owner'));
    const reviewerKeys = Array.isArray(entry.reviewers) ? (entry.reviewers as unknown[]) : [];
    const id = randomUUID();
    const room = await withEvents(async (client) => {
      const inserted = await client.query(
        `insert into rooms (id, part_slug, base_revision_id, head_revision_id, title, state,
           required_approvals, created_by, created_at)
         values ($1,$2,$3,$3,$4,'open',$5,$6,$7) returning *`,
        [id, slug, head.id, normaliseText(textOf(entry, 'title')) || 'Review', config.requiredApprovals, ownerId, createdAt],
      );
      for (const reviewerKey of reviewerKeys) {
        const name = typeof reviewerKey === 'string' ? reviewerKey : '';
        const email = userEmails[name] ?? name;
        await client.query(
          'insert into room_reviewers (room_id, email, email_folded) values ($1,$2,$3) on conflict do nothing',
          [id, email, foldEmail(email)],
        );
      }
      return inserted.rows[0];
    });
    rooms[key] = { id: room.id };
  }

  for (const entry of list(ctx.body, 'comments')) {
    const key = textOf(entry, 'key');
    const roomKey = textOf(entry, 'room');
    const roomId = rooms[roomKey]?.id ?? roomKey;
    const room = await query<{ id: string; part_slug: string; head_revision_id: string }>(
      'select id, part_slug, head_revision_id from rooms where id = $1',
      [roomId],
    );
    if (room.rowCount === 0) throw invalid({ comments: `Unknown room ${roomKey}.` });
    const authorId = await ownerIdOf(textOf(entry, 'author'));
    const id = randomUUID();
    const pose = entry.pose ?? poseOfBox({ min: [0, 0, 0], max: [1, 1, 1] });
    const anchor = entry.anchor ?? { kind: 'none' };
    await withEvents(async (client, emit) => {
      const inserted = await client.query(
        `insert into comments (id, room_id, author_id, body, anchor, pose, revision_id, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [
          id,
          roomId,
          authorId,
          normaliseText(textOf(entry, 'body')),
          JSON.stringify(anchor),
          JSON.stringify(pose),
          room.rows[0].head_revision_id,
          createdAt,
        ],
      );
      const { commentJson } = await import('../records');
      await emit({
        slug: room.rows[0].part_slug,
        roomId,
        type: 'comment',
        data: { type: 'comment', comment: await commentJson(inserted.rows[0], client) },
      });
    });
    comments[key] = { id };
  }

  for (const entry of list(ctx.body, 'approvals')) {
    const roomKey = textOf(entry, 'room');
    const roomId = rooms[roomKey]?.id ?? roomKey;
    const room = await query<{
      id: string;
      part_slug: string;
      head_revision_id: string;
      required_approvals: number;
    }>('select id, part_slug, head_revision_id, required_approvals from rooms where id = $1', [roomId]);
    if (room.rowCount === 0) throw invalid({ approvals: `Unknown room ${roomKey}.` });
    const reviewerId = await ownerIdOf(textOf(entry, 'reviewer'));
    const head = await loadRevision(room.rows[0].head_revision_id);
    if (!head) throw notFound();
    await withEvents(async (client, emit) => {
      await client.query(
        `insert into approvals (id, room_id, reviewer_id, revision_id, geometry_digest, at)
         values ($1,$2,$3,$4,$5,$6) on conflict (room_id, reviewer_id, geometry_digest) do nothing`,
        [randomUUID(), roomId, reviewerId, head.id, head.geometry_digest, createdAt],
      );
      const counted = await client.query<{ count: string }>(
        'select count(*)::text as count from approvals where room_id = $1 and geometry_digest = $2',
        [roomId, head.geometry_digest],
      );
      const state = Number(counted.rows[0].count) >= room.rows[0].required_approvals ? 'approved' : 'open';
      const updated = await client.query('update rooms set state = $1 where id = $2 returning *', [
        state,
        roomId,
      ]);
      await emit({
        slug: room.rows[0].part_slug,
        roomId,
        type: 'approvals',
        data: {
          type: 'approvals',
          room: await roomJson(updated.rows[0], client),
          reason: 'approved',
          label: revisionLabel(head.label_number),
          displayName: null,
        },
      });
    });
  }

  for (const entry of list(ctx.body, 'likes')) {
    const partKey = textOf(entry, 'part');
    const slug = partSlugs[partKey] ?? partKey;
    const part = await loadPart(slug);
    if (!part) throw invalid({ likes: `Unknown part ${partKey}.` });
    const keys = Array.isArray(entry.users) ? (entry.users as unknown[]) : [];
    for (const userKey of keys) {
      const userId = await ownerIdOf(typeof userKey === 'string' ? userKey : '');
      await withEvents(async (client, emit) => {
        await client.query(
          'insert into likes (part_slug, user_id, created_at) values ($1,$2,$3) on conflict do nothing',
          [slug, userId, createdAt],
        );
        const count = await client.query<{ count: string }>(
          'select count(*)::text as count from likes where part_slug = $1',
          [slug],
        );
        await emit({
          slug,
          roomId: null,
          type: 'like',
          data: { type: 'like', partSlug: slug, likes: Number(count.rows[0].count) },
        });
      });
    }
  }

  sendJson(ctx, 201, { users, parts, revisions, rooms, comments });
}

export async function gradingEvaluatorDelay(ctx: Ctx): Promise<void> {
  checkNumberGrammar(ctx.raw, null);
  const slug = typeof ctx.body.partSlug === 'string' ? ctx.body.partSlug : '';
  const ms = ctx.body.ms;
  if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 0 || ms > 600000) {
    throw invalid({ ms: 'Enter a whole number of milliseconds from 0 to 600000.' });
  }
  await setEvaluatorDelay(slug, ms);
  ctx.res.writeHead(204).end();
}

export async function gradingEvaluations(ctx: Ctx): Promise<void> {
  const viewerId = ctx.url.searchParams.get('viewerId') ?? '';
  sendJson(ctx, 200, await evaluationCounts(viewerId));
}

export async function gradingDropStreams(ctx: Ctx): Promise<void> {
  await publishDropStreams();
  ctx.res.writeHead(204).end();
}
