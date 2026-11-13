import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { query } from '../db';
import { ApiError, forbidden, invalid, mailUnavailableRoom, notFound, roomClosed } from '../errors';
import { Ctx, sendJson } from '../http';
import { IdempotentAnswer, withIdempotency } from '../idempotency';
import {
  canReadRoom,
  commentJson,
  headRevisionOf,
  isRoomReviewer,
  listComments,
  loadRevision,
  loadRoom,
  revisionLabel,
  roomJson,
} from '../records';
import { withEvents } from '../parts';
import { MailUnavailable, sendInvitationMail } from '../mail';
import { foldEmail, graphemeLength, normaliseText } from '../../shared/order';
import { validEmail } from '../auth';
import { checkNumberGrammar } from '../values';
import { ownedPart, readablePart, requireUser } from './helpers';
import { poseOfBox } from '../../tine/preflight';

type Anchor = { kind: 'point'; position: [number, number, number] } | { kind: 'none' };

function readAnchor(value: unknown): Anchor {
  if (value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'point') {
    const position = (value as { position?: unknown }).position;
    if (
      Array.isArray(position) &&
      position.length === 3 &&
      position.every((entry) => typeof entry === 'number')
    ) {
      return { kind: 'point', position: position as [number, number, number] };
    }
    throw invalid({ anchor: 'Enter a point on the solid.' });
  }
  return { kind: 'none' };
}

function readPose(value: unknown): Record<string, unknown> {
  const fallback = poseOfBox({ min: [0, 0, 0], max: [1, 1, 1] });
  if (!value || typeof value !== 'object') return fallback as unknown as Record<string, unknown>;
  const pose = value as Record<string, unknown>;
  const triple = (name: string): [number, number, number] | null => {
    const entry = pose[name];
    if (Array.isArray(entry) && entry.length === 3 && entry.every((part) => typeof part === 'number')) {
      return entry as [number, number, number];
    }
    return null;
  };
  const position = triple('position');
  const target = triple('target');
  const up = triple('up');
  const fov = typeof pose.fov === 'number' ? pose.fov : fallback.fov;
  if (!position || !target) return fallback as unknown as Record<string, unknown>;
  return { position, target, up: up ?? [0, 0, 1], fov };
}

export async function createRoom(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const part = await readablePart(ctx, ctx.params.slug);
  ownedPart(part, user);
  const answer = await withIdempotency(ctx, async () => {
    checkNumberGrammar(ctx.raw, null);
    const title = typeof ctx.body.title === 'string' ? normaliseText(ctx.body.title.trim()) : '';
    const reviewers = Array.isArray(ctx.body.reviewers) ? ctx.body.reviewers : [];
    const errors: Record<string, string> = {};
    if (graphemeLength(title) < 1 || graphemeLength(title) > 80) errors.title = 'Use 1 to 80 characters.';
    const emails = reviewers.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim());
    if (emails.length !== reviewers.length || emails.some((email) => !validEmail(email))) {
      errors.reviewers = 'Enter valid email addresses.';
    } else {
      const unique = new Set(emails.map(foldEmail));
      if (unique.size < config.requiredApprovals) {
        errors.reviewers = `Invite at least ${config.requiredApprovals} reviewers.`;
      }
    }
    if (Object.keys(errors).length > 0) throw invalid(errors);

    const head = await headRevisionOf(part.slug);
    if (!head) throw notFound();
    const id = randomUUID();
    const unique: string[] = [];
    for (const email of emails) {
      if (!unique.some((entry) => foldEmail(entry) === foldEmail(email))) unique.push(email);
    }

    try {
      for (const email of unique) {
        await sendInvitationMail(
          email,
          part.title,
          title,
          id,
          revisionLabel(head.label_number),
          head.volume,
        );
      }
    } catch (error) {
      if (error instanceof MailUnavailable) throw mailUnavailableRoom();
      throw error;
    }

    const room = await withEvents(async (client) => {
      const inserted = await client.query(
        `insert into rooms (id, part_slug, base_revision_id, head_revision_id, title, state,
           required_approvals, created_by, created_at)
         values ($1,$2,$3,$3,$4,'open',$5,$6, now()) returning *`,
        [id, part.slug, head.id, title, config.requiredApprovals, user.id],
      );
      for (const email of unique) {
        await client.query(
          'insert into room_reviewers (room_id, email, email_folded) values ($1,$2,$3) on conflict do nothing',
          [id, email, foldEmail(email)],
        );
      }
      return inserted.rows[0];
    });

    return {
      status: 201,
      body: await roomJson(room),
      location: `/api/rooms/${id}`,
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

async function readableRoom(ctx: Ctx): Promise<Awaited<ReturnType<typeof loadRoom>>> {
  requireUser(ctx);
  const room = await loadRoom(ctx.params.id);
  if (!room) throw notFound();
  if (!(await canReadRoom(room, ctx.user))) throw notFound();
  return room;
}

export async function getRoom(ctx: Ctx): Promise<void> {
  const room = (await readableRoom(ctx))!;
  const comments = await listComments(room.id);
  sendJson(ctx, 200, {
    room: await roomJson(room),
    comments: await Promise.all(comments.map((comment) => commentJson(comment))),
  });
}

export async function postComment(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const room = (await readableRoom(ctx))!;
  const answer = await withIdempotency(ctx, async () => {
    if (room.state === 'closed') throw roomClosed();
    checkNumberGrammar(ctx.raw, null);
    const body = typeof ctx.body.body === 'string' ? normaliseText(ctx.body.body) : '';
    if (body.trim().length === 0) throw invalid({ body: 'Write a comment first.' });
    if (graphemeLength(body) > config.commentMaxChars) {
      throw new ApiError(422, {
        error: 'comment_too_long',
        message: `Comments can be at most ${config.commentMaxChars} characters.`,
        errors: { body: `Comments can be at most ${config.commentMaxChars} characters.` },
      });
    }
    const anchor = readAnchor(ctx.body.anchor);
    const pose = readPose(ctx.body.pose);
    const id = randomUUID();
    const comment = await withEvents(async (client, emit) => {
      const inserted = await client.query(
        `insert into comments (id, room_id, author_id, body, anchor, pose, revision_id, created_at)
         values ($1,$2,$3,$4,$5,$6,$7, now()) returning *`,
        [id, room.id, user.id, body, JSON.stringify(anchor), JSON.stringify(pose), room.head_revision_id],
      );
      const json = await commentJson(inserted.rows[0], client);
      await emit({
        slug: room.part_slug,
        roomId: room.id,
        type: 'comment',
        data: { type: 'comment', comment: json },
      });
      return json;
    });
    return { status: 201, body: comment } satisfies IdempotentAnswer;
  });
  sendAnswer(ctx, answer);
}

export async function postApproval(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const room = (await readableRoom(ctx))!;
  const answer = await withIdempotency(ctx, async () => {
    if (room.state === 'closed') throw roomClosed();
    const revisionId = typeof ctx.body.revisionId === 'string' ? ctx.body.revisionId : '';
    const revision = await loadRevision(revisionId);
    if (!revision || revision.part_slug !== room.part_slug) throw notFound();
    const head = await loadRevision(room.head_revision_id);
    if (!head) throw notFound();
    if (!(await isRoomReviewer(room.id, user))) {
      throw new ApiError(422, {
        error: 'own_revision',
        message: 'Owners cannot approve their own revision.',
      });
    }
    if (revision.id !== head.id) {
      throw new ApiError(409, {
        error: 'stale_revision',
        message: `${revisionLabel(revision.label_number)} is no longer the head; review ${revisionLabel(
          head.label_number,
        )} before approving.`,
      });
    }

    const outcome = await withEvents(async (client, emit) => {
      const inserted = await client.query(
        `insert into approvals (id, room_id, reviewer_id, revision_id, geometry_digest, at)
         values ($1,$2,$3,$4,$5, now()) on conflict (room_id, reviewer_id, geometry_digest) do nothing
         returning id`,
        [randomUUID(), room.id, user.id, revision.id, revision.geometry_digest],
      );
      const created = inserted.rowCount === 1;
      const counted = await client.query<{ count: string }>(
        'select count(*)::text as count from approvals where room_id = $1 and geometry_digest = $2',
        [room.id, revision.geometry_digest],
      );
      const total = Number(counted.rows[0].count);
      const state = total >= room.required_approvals ? 'approved' : 'open';
      const updated = await client.query(
        'update rooms set state = $1 where id = $2 returning *',
        [state, room.id],
      );
      const json = await roomJson(updated.rows[0], client);
      if (created) {
        await emit({
          slug: room.part_slug,
          roomId: room.id,
          type: 'approvals',
          data: {
            type: 'approvals',
            room: json,
            reason: 'approved',
            label: revisionLabel(revision.label_number),
            displayName: user.displayName,
          },
        });
      }
      return { created, json };
    });

    return { status: outcome.created ? 201 : 200, body: outcome.json } satisfies IdempotentAnswer;
  });
  sendAnswer(ctx, answer);
}

export async function closeRoom(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const room = (await readableRoom(ctx))!;
  if (room.created_by !== user.id) throw forbidden();
  if (room.state === 'closed') throw roomClosed();
  const json = await withEvents(async (client, emit) => {
    const updated = await client.query('update rooms set state = $1 where id = $2 returning *', [
      'closed',
      room.id,
    ]);
    const head = await loadRevision(room.head_revision_id);
    const body = await roomJson(updated.rows[0], client);
    await emit({
      slug: room.part_slug,
      roomId: room.id,
      type: 'approvals',
      data: {
        type: 'approvals',
        room: body,
        reason: 'closed',
        label: head ? revisionLabel(head.label_number) : '',
        displayName: null,
      },
    });
    return body;
  });
  sendJson(ctx, 200, json);
}
