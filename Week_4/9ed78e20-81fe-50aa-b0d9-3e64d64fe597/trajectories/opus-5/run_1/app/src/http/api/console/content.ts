import { randomUUID } from 'node:crypto';
import { pool, withTransaction, type Queryable } from '../../../db/pool.js';
import { appendAuditEntry } from '../../../domain/audit.js';
import { validateClaims } from '../../../domain/claims.js';
import { findComparator, ALDERMOOR } from '../../../domain/comparators.js';
import {
  CONTENT_COLUMNS,
  allBenchmarkRows,
  loadContentById,
  loadContentBySlug,
  type ContentKind,
  type ContentRow,
} from '../../../domain/content.js';
import {
  CONTENT_STATUSES,
  commentsOpen,
  contentEditable,
  contentMoveAllowed,
  type ContentStatus,
} from '../../../domain/lifecycle.js';
import { londonLocalToInstant } from '../../../domain/london.js';
import { releaseContentItem, withdrawContentItem } from '../../../domain/release.js';
import {
  RELEASE_RECORD_COLUMNS,
  loadReleaseRecord,
  releaseRecordObject,
  signedState,
  signoffsLapsed,
  voidRecordForEdit,
  type ReleaseRecordRow,
} from '../../../domain/releaserecord.js';
import { queueSignoffRequest } from '../../../services/notifications.js';
import { ApiError, errors } from '../../errors.js';
import { jsonReply } from '../../reply.js';
import { route } from '../../server.js';
import {
  consoleRead,
  consoleWrite,
  etag,
  ifMatch,
  objectBody,
  onlyKeys,
  requireRole,
  requireText,
  type Session,
} from './guard.js';
import {
  CONTENT_FIELD_MESSAGES,
  checkBenchmarkRowInput,
  contentObject,
  knownRowSubject,
  loadComments,
  readContentFields,
} from './contentshape.js';

const BASE_KEYS = ['slug', 'title', 'summary', 'body'] as const;
const NEWS_KEYS = ['subject', 'tags'] as const;
const MODEL_KEYS = ['claims', 'linked_news_slug'] as const;

function keysFor(kind: ContentKind | null): string[] {
  if (kind === 'news') return [...BASE_KEYS, ...NEWS_KEYS];
  if (kind === 'model') return [...BASE_KEYS, ...MODEL_KEYS];
  return [...BASE_KEYS];
}

function requireAuthorEditor(session: Session, row: ContentRow): void {
  if (row.author !== session.staff.email) throw errors.forbidden();
  requireRole(session, 'editor');
}

function requireApproverNotAuthor(session: Session, row: ContentRow): void {
  if (row.author === session.staff.email) throw errors.authorCannotApprove();
  requireRole(session, 'approver');
}

async function lockContent(tx: Queryable, id: string): Promise<ContentRow> {
  const result = await tx.query<ContentRow>(
    `SELECT ${CONTENT_COLUMNS} FROM content_items WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const row = result.rows[0];
  if (row === undefined) throw errors.consoleNotFound();
  return row;
}

async function requireContent(id: string): Promise<ContentRow> {
  const row = await loadContentById(pool, id);
  if (row === undefined) throw errors.consoleNotFound();
  return row;
}

async function contentReply(
  tx: Queryable,
  id: string,
  status: number,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<ReturnType<typeof jsonReply>> {
  const row = await loadContentById(tx, id);
  if (row === undefined) throw errors.consoleNotFound();
  const comments = await loadComments(tx, [row.id]);
  return jsonReply(
    status,
    { content: contentObject(row, comments.get(row.id) ?? []), ...extra },
    etag(row.version),
  );
}

async function moveStatus(
  tx: Queryable,
  row: ContentRow,
  version: number,
  to: ContentStatus,
  set: string = '',
  params: readonly unknown[] = [],
): Promise<void> {
  if (!contentMoveAllowed(row.status, to)) throw errors.illegalTransition(row.status, to);
  const result = await tx.query(
    `UPDATE content_items SET status = $3${set === '' ? '' : `, ${set}`}, version = version + 1
      WHERE id = $1 AND version = $2`,
    [row.id, version, to, ...params],
  );
  if ((result.rowCount ?? 0) === 0) throw errors.staleVersion();
}

async function approverRecipients(
  tx: Queryable,
  author: string,
): Promise<{ name: string; email: string }[]> {
  const result = await tx.query<{ name: string; email: string }>(
    `SELECT DISTINCT s.name, s.email FROM role_grants g JOIN staff s ON s.email = g.staff_email
      WHERE g.role = 'approver' AND g.revoked_at IS NULL AND g.expires_at > now()
        AND g.staff_email <> $1
      ORDER BY s.email`,
    [author],
  );
  return result.rows;
}

async function requireReleaseRecord(
  tx: Queryable,
  row: ContentRow,
): Promise<ReleaseRecordRow> {
  if (row.kind !== 'model') throw errors.consoleNotFound();
  const record = await loadReleaseRecord(tx, row.id);
  if (record === undefined) throw errors.consoleNotFound();
  return record;
}

async function lockReleaseRecord(tx: Queryable, contentId: string): Promise<ReleaseRecordRow> {
  const result = await tx.query<ReleaseRecordRow>(
    `SELECT ${RELEASE_RECORD_COLUMNS} FROM release_records WHERE content_id = $1 FOR UPDATE`,
    [contentId],
  );
  const row = result.rows[0];
  if (row === undefined) throw errors.consoleNotFound();
  return row;
}

async function namedByModelRoute(
  tx: Queryable,
  slug: string,
  onlyScheduled: boolean,
): Promise<boolean> {
  const result = await tx.query(
    `SELECT 1 FROM content_items
      WHERE kind = 'model' AND linked_news_slug = $1
        AND ($2::boolean = false OR status = 'scheduled')`,
    [slug, onlyScheduled],
  );
  return (result.rowCount ?? 0) > 0;
}

export function registerConsoleContentApi(): void {
  route('GET', '/api/console/content', null, async (ctx) =>
    consoleRead(ctx, async (session) => {
      requireRole(session, 'editor', 'approver');
      const status = ctx.url.searchParams.get('status');
      const result = await pool.query<ContentRow>(
        `SELECT ${CONTENT_COLUMNS} FROM content_items
          WHERE ($1::text IS NULL OR status = $1::text)
          ORDER BY created_at DESC, id`,
        [status !== null && CONTENT_STATUSES.includes(status as ContentStatus) ? status : null],
      );
      const comments = await loadComments(pool, result.rows.map((row) => row.id));
      return jsonReply(200, {
        items: result.rows.map((row) => contentObject(row, comments.get(row.id) ?? [])),
      });
    }),
  );

  route('POST', '/api/console/content', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      requireRole(session, 'editor');
      const payload = objectBody(ctx.json());
      const rawKind = typeof payload.kind === 'string' ? payload.kind : '';
      const kind: ContentKind | null =
        rawKind === 'model' || rawKind === 'news' ? rawKind : null;
      onlyKeys(payload, ['kind', ...keysFor(kind)]);
      if (kind === null) throw errors.validationFailed({ kind: CONTENT_FIELD_MESSAGES.kind });

      for (const key of ['slug', 'title', 'summary', 'body']) {
        if (!(key in payload)) payload[key] = '';
      }
      if (kind === 'news') {
        if (!('subject' in payload)) payload.subject = '';
        if (!('tags' in payload)) payload.tags = [];
      } else if (!('claims' in payload)) {
        payload.claims = [];
      }

      const created = await withTransaction(async (tx) => {
        const fields = await readContentFields(tx, kind, payload, { id: null });
        const id = randomUUID();
        await tx.query(
          `INSERT INTO content_items (id, kind, slug, title, summary, body, subject, tags, claims,
             linked_news_slug, status, author, version, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,1, now())`,
          [
            id,
            kind,
            fields.slug,
            fields.title,
            fields.summary,
            fields.body,
            kind === 'news' ? fields.subject : null,
            kind === 'news' ? (fields.tags ?? []) : null,
            kind === 'model' ? JSON.stringify(fields.claims ?? []) : null,
            kind === 'model' ? (fields.linked_news_slug ?? null) : null,
            session.staff.email,
          ],
        );
        if (kind === 'model') {
          await tx.query(
            `INSERT INTO release_records (content_id, status) VALUES ($1, 'open')`,
            [id],
          );
        }
        await appendAuditEntry(tx, {
          actor: session.staff.email,
          action: 'content.create',
          targetType: 'content',
          targetId: id,
          detail: { kind, slug: fields.slug ?? '' },
        });
        return id;
      });
      return contentReply(pool, created, 201);
    }),
  );

  route('GET', '/api/console/content/:id', null, async (ctx) =>
    consoleRead(ctx, async (session) => {
      await requireContent(ctx.params.id as string);
      requireRole(session, 'editor', 'approver');
      return contentReply(pool, ctx.params.id as string, 200);
    }),
  );

  route('PATCH', '/api/console/content/:id', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      const id = ctx.params.id as string;
      const existing = await requireContent(id);
      requireAuthorEditor(session, existing);
      const version = ifMatch(ctx);
      const payload = objectBody(ctx.json());
      onlyKeys(payload, keysFor(existing.kind));
      if (Object.keys(payload).length === 0) {
        throw errors.validationFailed({ changes: 'Send at least one field to change.' });
      }

      await withTransaction(async (tx) => {
        const row = await lockContent(tx, id);
        if (row.version !== version) throw errors.staleVersion();
        if (!contentEditable(row.status)) {
          throw errors.conflict('not_editable', 'Only drafts and returned items can be edited.');
        }
        const fields = await readContentFields(tx, row.kind, payload, { id: row.id });
        const updated = await tx.query(
          `UPDATE content_items SET
             slug = COALESCE($3, slug),
             title = COALESCE($4, title),
             summary = COALESCE($5, summary),
             body = COALESCE($6, body),
             subject = CASE WHEN $7::text IS NULL THEN subject ELSE $7::text END,
             tags = CASE WHEN $8::text[] IS NULL THEN tags ELSE $8::text[] END,
             claims = CASE WHEN $9::jsonb IS NULL THEN claims ELSE $9::jsonb END,
             linked_news_slug = CASE WHEN $10::boolean THEN $11::text ELSE linked_news_slug END,
             version = version + 1
            WHERE id = $1 AND version = $2`,
          [
            id,
            version,
            fields.slug ?? null,
            fields.title ?? null,
            fields.summary ?? null,
            fields.body ?? null,
            fields.subject ?? null,
            fields.tags ?? null,
            fields.claims === undefined ? null : JSON.stringify(fields.claims),
            'linked_news_slug' in payload,
            fields.linked_news_slug ?? null,
          ],
        );
        if ((updated.rowCount ?? 0) === 0) throw errors.staleVersion();
        await appendAuditEntry(tx, {
          actor: session.staff.email,
          action: 'content.update',
          targetType: 'content',
          targetId: id,
          detail: { kind: row.kind, changed: Object.keys(payload).sort() },
        });
        if (row.kind === 'model') {
          await voidRecordForEdit(tx, id, session.staff.email);
        }
      });
      return contentReply(pool, id, 200);
    }),
  );

  route('POST', '/api/console/content/:id/submit', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      const id = ctx.params.id as string;
      const existing = await requireContent(id);
      requireAuthorEditor(session, existing);
      const version = ifMatch(ctx);
      onlyKeys(objectBody(ctx.json()), []);

      await withTransaction(async (tx) => {
        const row = await lockContent(tx, id);
        if (row.version !== version) throw errors.staleVersion();
        await moveStatus(tx, row, version, 'in_review');
        await appendAuditEntry(tx, {
          actor: session.staff.email,
          action: 'content.submit',
          targetType: 'content',
          targetId: id,
          detail: { kind: row.kind, from: row.status },
        });
        if (row.kind === 'model') {
          for (const approver of await approverRecipients(tx, row.author)) {
            await queueSignoffRequest(tx, {
              to: approver,
              title: row.title,
              contentId: row.id,
            });
          }
        }
      });
      return contentReply(pool, id, 200);
    }),
  );

  route('POST', '/api/console/content/:id/comments', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      const id = ctx.params.id as string;
      const existing = await requireContent(id);
      requireRole(session, 'editor', 'approver');
      const payload = objectBody(ctx.json());
      onlyKeys(payload, ['body']);
      const body = requireText(payload, 'body', {
        min: 1,
        max: 4000,
        message: 'Enter a comment of at most 4,000 characters.',
      });
      if (!commentsOpen(existing.status)) {
        throw errors.conflict(
          'comments_closed',
          'Comments are closed once an item is scheduled.',
        );
      }
      const comment = await withTransaction(async (tx) => {
        const row = await lockContent(tx, id);
        if (!commentsOpen(row.status)) {
          throw errors.conflict(
            'comments_closed',
            'Comments are closed once an item is scheduled.',
          );
        }
        const commentId = randomUUID();
        const inserted = await tx.query<{ created_at: Date }>(
          `INSERT INTO content_comments (id, content_id, author, body, created_at)
           VALUES ($1,$2,$3,$4, now()) RETURNING created_at`,
          [commentId, id, session.staff.email, body],
        );
        await appendAuditEntry(tx, {
          actor: session.staff.email,
          action: 'content.comment',
          targetType: 'content',
          targetId: id,
          detail: { comment_id: commentId },
        });
        return {
          id: commentId,
          author: session.staff.email,
          body,
          created_at: (inserted.rows[0]?.created_at ?? new Date()).toISOString(),
        };
      });
      return jsonReply(201, { comment });
    }),
  );

  route('POST', '/api/console/content/:id/approve', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      const id = ctx.params.id as string;
      const existing = await requireContent(id);
      requireApproverNotAuthor(session, existing);
      const version = ifMatch(ctx);
      onlyKeys(objectBody(ctx.json()), []);
      await withTransaction(async (tx) => {
        const row = await lockContent(tx, id);
        if (row.version !== version) throw errors.staleVersion();
        await moveStatus(tx, row, version, 'approved');
        await appendAuditEntry(tx, {
          actor: session.staff.email,
          action: 'content.approve',
          targetType: 'content',
          targetId: id,
          detail: { kind: row.kind },
        });
      });
      return contentReply(pool, id, 200);
    }),
  );

  route('POST', '/api/console/content/:id/return', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      const id = ctx.params.id as string;
      const existing = await requireContent(id);
      requireApproverNotAuthor(session, existing);
      const version = ifMatch(ctx);
      const payload = objectBody(ctx.json());
      onlyKeys(payload, ['reason']);
      const reason = requireText(payload, 'reason', {
        min: 1,
        max: 2000,
        message: 'Say what needs to change.',
      });
      await withTransaction(async (tx) => {
        const row = await lockContent(tx, id);
        if (row.version !== version) throw errors.staleVersion();
        await moveStatus(tx, row, version, 'returned');
        await appendAuditEntry(tx, {
          actor: session.staff.email,
          action: 'content.return',
          targetType: 'content',
          targetId: id,
          detail: { kind: row.kind, reason },
        });
      });
      return contentReply(pool, id, 200);
    }),
  );

  route('POST', '/api/console/content/:id/schedule', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      const id = ctx.params.id as string;
      const existing = await requireContent(id);
      requireApproverNotAuthor(session, existing);
      const version = ifMatch(ctx);
      const payload = objectBody(ctx.json());
      onlyKeys(payload, ['release_at_local']);
      const raw =
        typeof payload.release_at_local === 'string' ? payload.release_at_local.trim() : '';
      const parsed = londonLocalToInstant(raw);
      if (parsed.kind === 'malformed') {
        throw errors.validationFailed({
          release_at_local: 'Use the form YYYY-MM-DDTHH:mm.',
        });
      }
      if (parsed.kind === 'nonexistent') {
        throw errors.validationFailed({
          release_at_local:
            'That time does not exist in London because the clocks go forward.',
        });
      }
      if (parsed.instant.getTime() <= Date.now()) {
        throw errors.validationFailed({ release_at_local: 'Choose a time in the future.' });
      }

      await withTransaction(async (tx) => {
        const row = await lockContent(tx, id);
        if (row.version !== version) throw errors.staleVersion();
        if (row.kind === 'news' && (await namedByModelRoute(tx, row.slug, false))) {
          throw errors.conflict('linked_to_model', 'This post releases with its model route.');
        }
        let linked: ContentRow | undefined;
        if (row.kind === 'model') {
          const record = await requireReleaseRecord(tx, row);
          if (record.status !== 'cleared') {
            throw errors.conflict(
              'release_record_not_cleared',
              "This model route's release record is not cleared.",
            );
          }
          if (row.linked_news_slug !== null) {
            linked = await loadContentBySlug(tx, 'news', row.linked_news_slug);
            if (linked === undefined || linked.status !== 'approved') {
              throw errors.conflict(
                'linked_post_not_ready',
                'The linked announcement must be approved before scheduling.',
              );
            }
          }
        }
        await moveStatus(
          tx,
          row,
          version,
          'scheduled',
          'release_at = $4, release_at_local = $5, scheduled_by = $6',
          [parsed.instant, raw, session.staff.email],
        );
        await appendAuditEntry(tx, {
          actor: session.staff.email,
          action: 'content.schedule',
          targetType: 'content',
          targetId: id,
          detail: {
            kind: row.kind,
            release_at: parsed.instant.toISOString(),
            release_at_local: raw,
            zone: 'Europe/London',
          },
        });
        if (linked !== undefined) {
          await moveStatus(
            tx,
            linked,
            linked.version,
            'scheduled',
            'release_at = $4, release_at_local = $5, scheduled_by = $6',
            [parsed.instant, raw, session.staff.email],
          );
          await appendAuditEntry(tx, {
            actor: session.staff.email,
            action: 'content.schedule',
            targetType: 'content',
            targetId: linked.id,
            detail: {
              kind: linked.kind,
              release_at: parsed.instant.toISOString(),
              release_at_local: raw,
              zone: 'Europe/London',
              linked_model: row.slug,
            },
          });
        }
      });
      return contentReply(pool, id, 200, { zone: 'Europe/London' });
    }),
  );

  route('POST', '/api/console/content/:id/release', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      const id = ctx.params.id as string;
      const existing = await requireContent(id);
      requireApproverNotAuthor(session, existing);
      const version = ifMatch(ctx);
      onlyKeys(objectBody(ctx.json()), []);
      await withTransaction(async (tx) => {
        const row = await lockContent(tx, id);
        if (row.version !== version) throw errors.staleVersion();
        if (row.kind === 'news' && (await namedByModelRoute(tx, row.slug, false))) {
          throw errors.conflict('linked_to_model', 'This post releases with its model route.');
        }
        if (!contentMoveAllowed(row.status, 'published')) {
          throw errors.illegalTransition(row.status, 'published');
        }
        const claimed = await tx.query(
          'UPDATE content_items SET version = version + 1 WHERE id = $1 AND version = $2',
          [id, version],
        );
        if ((claimed.rowCount ?? 0) === 0) throw errors.staleVersion();
        await releaseContentItem(tx, row, new Date(), session.staff.email);
      });
      return contentReply(pool, id, 200);
    }),
  );

  route('POST', '/api/console/content/:id/withdraw', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      const id = ctx.params.id as string;
      await requireContent(id);
      requireRole(session, 'approver');
      const version = ifMatch(ctx);
      onlyKeys(objectBody(ctx.json()), []);
      await withTransaction(async (tx) => {
        const row = await lockContent(tx, id);
        if (row.version !== version) throw errors.staleVersion();
        if (row.kind === 'news' && (await namedByModelRoute(tx, row.slug, true))) {
          throw errors.conflict('linked_to_model', 'This post releases with its model route.');
        }
        if (!contentMoveAllowed(row.status, 'withdrawn')) {
          throw errors.illegalTransition(row.status, 'withdrawn');
        }
        const claimed = await tx.query(
          'UPDATE content_items SET version = version + 1 WHERE id = $1 AND version = $2',
          [id, version],
        );
        if ((claimed.rowCount ?? 0) === 0) throw errors.staleVersion();
        await withdrawContentItem(tx, row, session.staff.email);
      });
      return contentReply(pool, id, 200);
    }),
  );

  route('GET', '/api/console/content/:id/release-record', null, async (ctx) =>
    consoleRead(ctx, async (session) => {
      const row = await requireContent(ctx.params.id as string);
      requireRole(session, 'editor', 'approver');
      const record = await requireReleaseRecord(pool, row);
      return jsonReply(200, { record: releaseRecordObject(record) });
    }),
  );

  route(
    'POST',
    '/api/console/content/:id/release-record/signoffs',
    'console_writes',
    async (ctx) =>
      consoleWrite(ctx, async (session) => {
        const id = ctx.params.id as string;
        const existing = await requireContent(id);
        if (existing.kind !== 'model') throw errors.consoleNotFound();
        requireApproverNotAuthor(session, existing);
        const payload = objectBody(ctx.json());
        onlyKeys(payload, ['kind', 'note']);
        const kind = payload.kind;
        if (kind !== 'safety' && kind !== 'legal') {
          throw errors.validationFailed({ kind: 'Choose safety or legal.' });
        }
        const note = typeof payload.note === 'string' ? payload.note.trim() : '';
        if ([...note].length > 2000) {
          throw errors.validationFailed({ note: 'Keep the note to 2,000 characters.' });
        }

        const record = await withTransaction(async (tx) => {
          const row = await lockContent(tx, id);
          const current = await lockReleaseRecord(tx, id);
          if (row.status !== 'in_review' && row.status !== 'approved') {
            throw errors.conflict(
              'not_in_review',
              'Sign-offs are recorded while a route is in review or approved.',
            );
          }
          const already = kind === 'safety' ? current.safety_by : current.legal_by;
          if (already !== null) {
            throw errors.conflict('already_signed', 'This sign-off is already recorded.');
          }
          const other = kind === 'safety' ? current.legal_by : current.safety_by;
          if (other === session.staff.email) {
            throw errors.conflict(
              'distinct_approver_required',
              'Safety and legal sign-off must come from different approvers.',
            );
          }
          const safety = kind === 'safety' ? session.staff.email : current.safety_by;
          const legal = kind === 'legal' ? session.staff.email : current.legal_by;
          const updated = await tx.query<ReleaseRecordRow>(
            `UPDATE release_records SET status = $2,
                safety_by = CASE WHEN $3 THEN $4 ELSE safety_by END,
                safety_at = CASE WHEN $3 THEN now() ELSE safety_at END,
                safety_note = CASE WHEN $3 THEN $5 ELSE safety_note END,
                legal_by = CASE WHEN $3 THEN legal_by ELSE $4 END,
                legal_at = CASE WHEN $3 THEN legal_at ELSE now() END,
                legal_note = CASE WHEN $3 THEN legal_note ELSE $5 END
              WHERE content_id = $1
              RETURNING ${RELEASE_RECORD_COLUMNS}`,
            [id, signedState(safety, legal), kind === 'safety', session.staff.email, note],
          );
          await appendAuditEntry(tx, {
            actor: session.staff.email,
            action: kind === 'safety' ? 'signoff.safety' : 'signoff.legal',
            targetType: 'release_record',
            targetId: id,
            detail: { kind, slug: row.slug },
          });
          return updated.rows[0] as ReleaseRecordRow;
        });
        return jsonReply(201, { record: releaseRecordObject(record) });
      }),
  );

  route(
    'POST',
    '/api/console/content/:id/release-record/validate-claims',
    'console_writes',
    async (ctx) =>
      consoleWrite(ctx, async (session) => {
        const id = ctx.params.id as string;
        const existing = await requireContent(id);
        if (existing.kind !== 'model') throw errors.consoleNotFound();
        requireRole(session, 'editor', 'approver');
        onlyKeys(objectBody(ctx.json()), []);

        const outcome = await withTransaction(async (tx) => {
          const row = await lockContent(tx, id);
          const current = await lockReleaseRecord(tx, id);
          if (current.safety_by === null || current.legal_by === null) {
            throw errors.conflict(
              'signoffs_incomplete',
              'Record both sign-offs before validating claims.',
            );
          }
          if (await signoffsLapsed(tx, current)) {
            throw errors.conflict(
              'signoff_lapsed',
              'A sign-off holder no longer holds the approver role. Record that sign-off again.',
            );
          }
          const rows = await allBenchmarkRows(tx);
          const result = validateClaims({
            slug: row.slug,
            title: row.title,
            body: row.body,
            claims: row.claims ?? [],
            rows,
          });
          const updated = await tx.query<ReleaseRecordRow>(
            `UPDATE release_records
                SET status = CASE WHEN $2 THEN 'claims_validated' ELSE $3 END,
                    claims_validated_at = CASE WHEN $2 THEN now() ELSE NULL END,
                    last_validation = $4::jsonb
              WHERE content_id = $1
              RETURNING ${RELEASE_RECORD_COLUMNS}`,
            [
              id,
              result.ok,
              signedState(current.safety_by, current.legal_by),
              JSON.stringify(result.verdicts),
            ],
          );
          await appendAuditEntry(tx, {
            actor: session.staff.email,
            action: 'claims.validate',
            targetType: 'release_record',
            targetId: id,
            detail: { ok: result.ok, claims: (row.claims ?? []).length },
          });
          return { result, record: updated.rows[0] as ReleaseRecordRow };
        });
        if (!outcome.result.ok) throw errors.claimsInvalid(outcome.result.fields);
        return jsonReply(200, { record: releaseRecordObject(outcome.record) });
      }),
  );

  route(
    'POST',
    '/api/console/content/:id/release-record/clear',
    'console_writes',
    async (ctx) =>
      consoleWrite(ctx, async (session) => {
        const id = ctx.params.id as string;
        const existing = await requireContent(id);
        if (existing.kind !== 'model') throw errors.consoleNotFound();
        requireApproverNotAuthor(session, existing);
        onlyKeys(objectBody(ctx.json()), []);

        const record = await withTransaction(async (tx) => {
          await lockContent(tx, id);
          const current = await lockReleaseRecord(tx, id);
          if (await signoffsLapsed(tx, current)) {
            throw errors.conflict(
              'signoff_lapsed',
              'A sign-off holder no longer holds the approver role. Record that sign-off again.',
            );
          }
          if (current.status !== 'claims_validated') {
            throw errors.conflict(
              'claims_not_validated',
              'Validate the claims before clearing this record.',
            );
          }
          const updated = await tx.query<ReleaseRecordRow>(
            `UPDATE release_records SET status='cleared', cleared_by=$2, cleared_at=now()
              WHERE content_id = $1 AND status = 'claims_validated'
              RETURNING ${RELEASE_RECORD_COLUMNS}`,
            [id, session.staff.email],
          );
          const row = updated.rows[0];
          if (row === undefined) {
            throw errors.conflict(
              'claims_not_validated',
              'Validate the claims before clearing this record.',
            );
          }
          await appendAuditEntry(tx, {
            actor: session.staff.email,
            action: 'release_record.clear',
            targetType: 'release_record',
            targetId: id,
            detail: { cleared_by: session.staff.email },
          });
          return row;
        });
        return jsonReply(200, { record: releaseRecordObject(record) });
      }),
  );

  route('GET', '/api/console/benchmark-rows', null, async (ctx) =>
    consoleRead(ctx, async (session) => {
      requireRole(session, 'editor', 'approver');
      const rows = await allBenchmarkRows(pool);
      const titles = await pool.query<{ slug: string; title: string }>(
        `SELECT slug, title FROM content_items WHERE kind = 'model'`,
      );
      const titleBySlug = new Map(titles.rows.map((row) => [row.slug, row.title]));
      return jsonReply(200, {
        rows: rows.map((row) => {
          const comparator = findComparator(row.subject);
          return {
            id: row.id,
            subject: row.subject,
            subject_name:
              comparator === undefined
                ? (titleBySlug.get(row.subject) ?? row.subject)
                : comparator.name,
            organisation: comparator === undefined ? ALDERMOOR : comparator.organisation,
            benchmark: row.benchmark,
            eval_date: row.eval_date,
            score: row.score_text,
            source_note: row.source_note,
          };
        }),
      });
    }),
  );

  route('POST', '/api/console/benchmark-rows', 'console_writes', async (ctx) =>
    consoleWrite(ctx, async (session) => {
      requireRole(session, 'editor', 'approver');
      const payload = objectBody(ctx.json());
      onlyKeys(payload, ['subject', 'benchmark', 'eval_date', 'score', 'source_note']);
      const input = checkBenchmarkRowInput(payload);
      if (!(await knownRowSubject(pool, input.subject))) {
        throw errors.validationFailed({
          subject: 'Choose a model route or a recorded comparator.',
        });
      }
      const row = await withTransaction(async (tx) => {
        const existing = await tx.query(
          `SELECT 1 FROM benchmark_rows WHERE subject=$1 AND benchmark=$2 AND eval_date=$3`,
          [input.subject, input.benchmark, input.eval_date],
        );
        if ((existing.rowCount ?? 0) > 0) {
          throw errors.conflict(
            'row_exists',
            'A row for this model, benchmark and date is already recorded.',
          );
        }
        const id = randomUUID();
        await tx.query(
          `INSERT INTO benchmark_rows (id, subject, benchmark, eval_date, score_text, score,
             source_note, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
          [
            id,
            input.subject,
            input.benchmark,
            input.eval_date,
            input.score,
            input.score,
            input.source_note,
          ],
        );
        await appendAuditEntry(tx, {
          actor: session.staff.email,
          action: 'row.create',
          targetType: 'benchmark_row',
          targetId: id,
          detail: {
            subject: input.subject,
            benchmark: input.benchmark,
            eval_date: input.eval_date,
            score: input.score,
          },
        });
        return id;
      });
      const comparator = findComparator(input.subject);
      const title = await pool.query<{ title: string }>(
        `SELECT title FROM content_items WHERE kind='model' AND slug=$1`,
        [input.subject],
      );
      return jsonReply(201, {
        row: {
          id: row,
          subject: input.subject,
          subject_name:
            comparator === undefined
              ? (title.rows[0]?.title ?? input.subject)
              : comparator.name,
          organisation: comparator === undefined ? ALDERMOOR : comparator.organisation,
          benchmark: input.benchmark,
          eval_date: input.eval_date,
          score: input.score,
          source_note: input.source_note,
        },
      });
    }),
  );

  for (const method of ['PATCH', 'DELETE']) {
    route(method, '/api/console/benchmark-rows/:id', 'console_writes', async (ctx) =>
      consoleWrite(ctx, async () => {
        throw new ApiError(405, 'rows_immutable', 'Recorded rows cannot be changed.');
      }),
    );
  }
}
