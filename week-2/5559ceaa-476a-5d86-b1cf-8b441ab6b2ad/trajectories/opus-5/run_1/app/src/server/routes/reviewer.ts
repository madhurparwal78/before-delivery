import { randomBytes, randomUUID } from 'node:crypto';
import type { ReviewerLink } from '../../shared/api.js';
import { config } from '../config.js';
import { pool, tx, type Queryable } from '../db.js';
import { readCheckpointBlobs } from '../domain/blobs.js';
import { assertCheckpointSaved } from '../domain/checkpointState.js';
import { hasPassed, reviewerLinkExpiry, reviewerLinkState } from '../domain/expiry.js';
import { illegalTransition, linkExpired, linkNotFound, linkRevoked, notFound } from '../http/errors.js';
import { REVIEW_HEADERS } from '../http/respond.js';
import type { AuthContext, Route } from '../http/router.js';
import { emailField, wholeNumberField } from '../http/validate.js';
import {
  assertMentor,
  loadCheckpoint,
  loadMembership,
  soleRow,
  writeAudit,
  type CheckpointRow,
} from '../repository.js';
import { requireIdempotencyKey, withIdempotency } from '../services/idempotency.js';
import { attempt, enqueue, formatUtcExpiry } from '../services/mail.js';
import { checkpointManifest, withStorage } from './checkpoints.js';

const HOURS_MESSAGE = 'Choose between 1 and 336 hours.';

interface LinkRow {
  id: string;
  checkpoint_id: string;
  project_id: string;
  token: string;
  expires_at: Date;
  revoked_at: Date | null;
  email_status: 'sent' | 'queued' | 'none';
}

const LINK_COLUMNS = 'id, checkpoint_id, project_id, token, expires_at, revoked_at, email_status';

function newReviewerToken(): string {
  return randomBytes(32).toString('base64url');
}

const reviewerUrl = (token: string) => `${config.publicUrl}/review/${token}`;

function view(row: LinkRow): ReviewerLink {
  return {
    id: row.id,
    checkpoint_id: row.checkpoint_id,
    url: reviewerUrl(row.token),
    expires_at: row.expires_at.toISOString(),
    state: reviewerLinkState(row, new Date()),
    email_status: row.email_status,
  };
}

async function mentorCheckpoint(ctx: AuthContext): Promise<CheckpointRow> {
  const checkpoint = await loadCheckpoint(pool, ctx.params['checkpoint_id'] ?? '');
  const membership = await loadMembership(pool, checkpoint.project_id, ctx.user.id);
  assertMentor(membership.role);
  return checkpoint;
}

async function mentorLink(ctx: AuthContext): Promise<LinkRow> {
  const linkId = ctx.params['link_id'] ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(linkId)) throw notFound();
  const { rows } = await pool.query<LinkRow>(
    `select ${LINK_COLUMNS} from reviewer_links where id = $1`,
    [linkId],
  );
  const row = rows[0];
  if (row === undefined) throw notFound();
  const membership = await loadMembership(pool, row.project_id, ctx.user.id);
  assertMentor(membership.role);
  return row;
}

function reviewerMessage(checkpointName: string, url: string, expiresAt: Date) {
  return {
    subject: `A Relay Bench checkpoint to review: ${checkpointName}`,
    body:
      `You have been sent a read-only Relay Bench checkpoint to review.\n\n` +
      `Checkpoint: ${checkpointName}\n${url}\n\n` +
      `The link expires ${formatUtcExpiry(expiresAt)}.\n`,
  };
}

async function createLink(
  ctx: AuthContext,
  checkpoint: CheckpointRow,
): Promise<{ status: number; payload: unknown }> {
  const fields = ctx.fields();
  const hours = wholeNumberField(fields, 'expires_in_hours', 1, 336, HOURS_MESSAGE);
  const email = fields['email'] === undefined ? null : emailField(fields, 'email');

  const createdAt = new Date();
  const expiresAt = reviewerLinkExpiry(createdAt, hours);
  const id = randomUUID();
  const token = newReviewerToken();
  const message = reviewerMessage(checkpoint.name, reviewerUrl(token), expiresAt);

  const prepared = await tx(async (client) => {
    const { rows } = await client.query<LinkRow>(
      `insert into reviewer_links (id, checkpoint_id, project_id, token, expires_at,
                                   email_status, created_at)
       values ($1, $2, $3, $4, $5, $6, $7) returning ${LINK_COLUMNS}`,
      [
        id,
        checkpoint.id,
        checkpoint.project_id,
        token,
        expiresAt,
        email === null ? 'none' : 'queued',
        createdAt,
      ],
    );
    const row = soleRow(rows);
    await writeAudit(client, {
      projectId: checkpoint.project_id,
      type: 'reviewer_link_created',
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      subject: { link_id: id, checkpoint_id: checkpoint.id, name: checkpoint.name },
    });
    if (email === null) return { row, outboxId: null };
    const outboxId = await enqueue(client, { to: email, ...message }, { linkId: id });
    return { row, outboxId };
  });

  if (prepared.outboxId === null || email === null) {
    return { status: 201, payload: { link: view(prepared.row) } };
  }
  const emailStatus = await attempt(prepared.outboxId, { to: email, ...message });
  return {
    status: 201,
    payload: { link: { ...view(prepared.row), email_status: emailStatus } },
  };
}

export const reviewerRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/checkpoints/:checkpoint_id/reviewer-links',
    scope: 'auth',
    body: 'json',
    handler: async (ctx) => {
      const checkpoint = await mentorCheckpoint(ctx);
      const key = requireIdempotencyKey(ctx.header('idempotency-key'));
      return withIdempotency(ctx.user.id, key, ctx.fields(), async () => {
        assertCheckpointSaved(checkpoint.state);
        return createLink(ctx, checkpoint);
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/checkpoints/:checkpoint_id/reviewer-links',
    scope: 'auth',
    body: 'none',
    handler: async (ctx) => {
      const checkpoint = await mentorCheckpoint(ctx);
      const { rows } = await pool.query<LinkRow>(
        `select ${LINK_COLUMNS} from reviewer_links where checkpoint_id = $1 order by created_at`,
        [checkpoint.id],
      );
      return { status: 200, payload: { links: rows.map(view) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/reviewer-links/:link_id/regenerate',
    scope: 'auth',
    body: 'none',
    handler: async (ctx) => {
      const link = await mentorLink(ctx);
      const state = reviewerLinkState(link, new Date());
      if (state !== 'active') throw illegalTransition(state, 'active');
      const updated = await tx(async (client) => {
        const { rows } = await client.query<LinkRow>(
          `update reviewer_links set token = $2 where id = $1 returning ${LINK_COLUMNS}`,
          [link.id, newReviewerToken()],
        );
        await writeAudit(client, {
          projectId: link.project_id,
          type: 'reviewer_link_regenerated',
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          subject: { link_id: link.id, checkpoint_id: link.checkpoint_id },
        });
        return soleRow(rows);
      });
      return { status: 200, payload: { link: view(updated) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/reviewer-links/:link_id/revoke',
    scope: 'auth',
    body: 'none',
    handler: async (ctx) => {
      const link = await mentorLink(ctx);
      const state = reviewerLinkState(link, new Date());
      if (state !== 'active') throw illegalTransition(state, 'revoked');
      const updated = await tx(async (client) => {
        const { rows } = await client.query<LinkRow>(
          `update reviewer_links set revoked_at = now() where id = $1 returning ${LINK_COLUMNS}`,
          [link.id],
        );
        await writeAudit(client, {
          projectId: link.project_id,
          type: 'reviewer_link_revoked',
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          subject: { link_id: link.id, checkpoint_id: link.checkpoint_id },
        });
        return soleRow(rows);
      });
      return { status: 200, payload: { link: view(updated) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/review/:token',
    scope: 'public',
    body: 'none',
    handler: async (ctx) => ({
      status: 200,
      payload: await reviewPayload(pool, ctx.params['token'] ?? ''),
      headers: { ...REVIEW_HEADERS },
    }),
  },
  { method: '*', pattern: '/api/review/:token', scope: 'method_not_allowed' },
  { method: '*', pattern: '/review/:token', scope: 'method_not_allowed' },
];

/** The reviewer's copy: one checkpoint, with no project, mentor or learner detail. */
async function reviewPayload(client: Queryable, token: string): Promise<unknown> {
  const { rows } = await client.query<LinkRow & { name: string; created_at: Date }>(
    `select l.id, l.checkpoint_id, l.project_id, l.token, l.expires_at, l.revoked_at,
            l.email_status, c.name, c.created_at
       from reviewer_links l join checkpoints c on c.id = l.checkpoint_id
      where l.token = $1`,
    [token],
  );
  const link = rows[0];
  if (link === undefined) throw linkNotFound();
  if (link.revoked_at !== null) throw linkRevoked();
  if (hasPassed(link.expires_at, new Date())) throw linkExpired();

  const manifest = await checkpointManifest(link.checkpoint_id);
  const stored = await withStorage(() => readCheckpointBlobs(link.project_id, manifest));
  return {
    checkpoint: {
      name: link.name,
      saved_at: link.created_at.toISOString(),
      expires_at: link.expires_at.toISOString(),
      files: stored.map(({ file, bytes }) => ({
        path: file.path,
        content: bytes.toString('utf8'),
      })),
    },
  };
}
