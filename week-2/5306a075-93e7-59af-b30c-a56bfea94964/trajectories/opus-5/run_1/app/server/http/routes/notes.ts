import type { NoteSource, NoteStatus } from '../../../shared/types';
import { newId, withTransaction } from '../../db';
import {
  AppError,
  NO_SUCH_RECORD,
  conflict,
  notFound,
  payloadTooLarge,
  unsupportedMediaType,
} from '../../errors';
import {
  MAX_ATTACHMENT_BYTES,
  attachmentObjectKey,
  bytesMatchExtension,
  canonicalContentType,
  contentDisposition,
  displayFilename,
  extensionOf,
  noteObjectPrefix,
} from '../../domain/attachments';
import { decodeInboxCursor, encodeInboxCursor } from '../../domain/cursor';
import { reanchorSpans } from '../../domain/reanchor';
import { sanitiseBody } from '../../domain/sanitize';
import { noteSnoozeAllowed, noteTransitionAllowed, noteTransitionError } from '../../domain/transitions';
import { LOCAL_DATE_TIME, toInstant, workspaceLocalToInstant } from '../../domain/zone';
import { findNote, loadNoteInsights, noteStatusCounts, listNotesPage } from '../../repo/notes';
import { recordAudit } from '../../repo/session';
import { getObject, putObject, StorageUnavailableError } from '../../services/storage';
import { Router, requirePrincipal, notFoundUnless, type RequestContext } from '../kernel';
import { parseMultipartFiles } from '../multipart';
import { FieldErrors, failField, hasKey } from '../validate';

const SOURCES: NoteSource[] = ['support_ticket', 'sales_call', 'email'];
const MAX_BODY_BYTES = 200_000;

async function resolveNote(ctx: RequestContext) {
  const principal = requirePrincipal(ctx);
  const note = notFoundUnless(await findNote(ctx.db, principal.workspaceId, ctx.params.id));
  return { principal, note };
}

async function requireContactId(
  ctx: RequestContext,
  workspaceId: string,
  value: unknown,
): Promise<string | null> {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') failField('contactId', NO_SUCH_RECORD);
  const { rows } = await ctx.db.query<{ id: string }>(
    'SELECT id FROM contacts WHERE workspace_id = $1 AND id = $2',
    [workspaceId, value],
  );
  if (rows.length === 0) failField('contactId', NO_SUCH_RECORD);
  return value;
}

function validateTitle(errors: FieldErrors, raw: unknown): string {
  if (typeof raw !== 'string') {
    errors.add('title', 'Add a title.');
    return '';
  }
  const title = raw.trim();
  if (title === '') errors.add('title', 'Add a title.');
  else if (title.length > 200) errors.add('title', 'Title must be 200 characters or fewer.');
  return title;
}

function validateBody(errors: FieldErrors, raw: unknown): { body: string; text: string } {
  if (typeof raw !== 'string') {
    errors.add('body', 'Add the note text.');
    return { body: '', text: '' };
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    errors.add('body', 'The note text is longer than 200,000 bytes.');
    return { body: '', text: '' };
  }
  const { body, doc } = sanitiseBody(raw);
  if (doc.text.trim() === '') errors.add('body', 'Add the note text.');
  return { body, text: doc.text };
}

export function registerNoteRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/notes',
    access: 'member',
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const errors = new FieldErrors();
      const rawStatus = ctx.url.searchParams.get('status') ?? 'unprocessed';
      let status: NoteStatus = 'unprocessed';
      if (rawStatus === 'unprocessed' || rawStatus === 'snoozed' || rawStatus === 'processed') {
        status = rawStatus;
      } else {
        errors.add('status', 'Status must be unprocessed, snoozed or processed.');
      }

      const rawLimit = ctx.url.searchParams.get('limit');
      let limit = 50;
      if (rawLimit !== null) {
        if (!/^\d+$/u.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) {
          errors.add('limit', 'Limit must be a whole number from 1 to 100.');
        } else {
          limit = Number(rawLimit);
        }
      }

      const rawCursor = ctx.url.searchParams.get('cursor');
      let after: { createdAt: string; id: string } | null = null;
      if (rawCursor !== null && rawCursor !== '') {
        const cursor = decodeInboxCursor(rawCursor);
        if (cursor === null || cursor.status !== status) {
          errors.add('cursor', 'The inbox changed filter. Showing the first page again.');
        } else {
          after = { createdAt: cursor.createdAt, id: cursor.id };
        }
      }
      errors.throwIfAny();

      const [{ page, hasMore }, counts] = await Promise.all([
        listNotesPage(ctx.db, principal.workspaceId, status, limit, after),
        noteStatusCounts(ctx.db, principal.workspaceId),
      ]);
      const last = page[page.length - 1];
      return {
        status: 200,
        json: {
          notes: page.map((row) => row.item),
          nextCursor:
            hasMore && last ? encodeInboxCursor({ status, createdAt: last.createdAt, id: last.item.id }) : null,
          counts,
        },
      };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/notes',
    access: 'member',
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const errors = new FieldErrors();
      const title = validateTitle(errors, ctx.body.title);
      const { body, text } = validateBody(errors, ctx.body.body);
      const source = ctx.body.source;
      if (typeof source !== 'string' || !SOURCES.includes(source as NoteSource)) {
        errors.add('source', 'Choose a source.');
      }
      errors.throwIfAny();
      const contactId = await requireContactId(ctx, principal.workspaceId, ctx.body.contactId);

      const noteId = newId();
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO notes (id, workspace_id, contact_id, title, body, text, source, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'unprocessed')`,
          [noteId, principal.workspaceId, contactId, title, body, text, source],
        );
        await recordAudit(client, principal.workspaceId, principal.memberId, 'note.create', 'note', noteId);
      });
      const note = await findNote(ctx.db, principal.workspaceId, noteId);
      return { status: 201, json: { note } };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/notes/:id',
    access: 'member',
    resolve: resolveNote,
    handle: async (_ctx, { note }) => ({ status: 200, json: { note } }),
  });

  router.add({
    method: 'PATCH',
    pattern: '/api/notes/:id',
    access: 'member',
    roles: ['head_of_product', 'product_manager'],
    resolve: resolveNote,
    handle: async (ctx, { principal, note }) => {
      const errors = new FieldErrors();
      const title = hasKey(ctx.body, 'title') ? validateTitle(errors, ctx.body.title) : note.title;
      const changesBody = hasKey(ctx.body, 'body');
      const parsed = changesBody ? validateBody(errors, ctx.body.body) : { body: note.body, text: note.text };
      errors.throwIfAny();
      const contactId = hasKey(ctx.body, 'contactId')
        ? await requireContactId(ctx, principal.workspaceId, ctx.body.contactId)
        : note.contact?.id ?? null;

      await withTransaction(async (client) => {
        if (changesBody) {
          const insights = await loadNoteInsights(client, note.id);
          const { moved, lost } = reanchorSpans(
            insights.map((insight) => ({
              id: insight.id,
              start: insight.start,
              end: insight.end,
              quote: insight.quote,
            })),
            parsed.text,
          );
          if (lost.length > 0) {
            throw conflict(
              'highlight_conflict',
              `This edit removes highlighted text from ${lost.length} linked insights.` +
                ' Unlink them first or keep that text.',
              { insightIds: lost },
            );
          }
          for (const span of moved) {
            await client.query('UPDATE insights SET start_offset = $1, end_offset = $2 WHERE id = $3', [
              span.start,
              span.end,
              span.id,
            ]);
          }
        }
        await client.query(
          'UPDATE notes SET title = $1, body = $2, text = $3, contact_id = $4 WHERE id = $5',
          [title, parsed.body, parsed.text, contactId, note.id],
        );
        await recordAudit(client, principal.workspaceId, principal.memberId, 'note.update', 'note', note.id);
      });
      const updated = await findNote(ctx.db, principal.workspaceId, note.id);
      return { status: 200, json: { note: updated } };
    },
  });

  router.add({
    method: 'DELETE',
    pattern: '/api/notes/:id',
    access: 'member',
    roles: ['head_of_product', 'product_manager'],
    resolve: resolveNote,
    handle: async (_ctx, { principal, note }) => {
      await withTransaction(async (client) => {
        await client.query('INSERT INTO pending_object_deletions (id, prefix) VALUES ($1, $2)', [
          newId(),
          noteObjectPrefix(note.id),
        ]);
        await recordAudit(client, principal.workspaceId, principal.memberId, 'note.delete', 'note', note.id);
        await client.query('DELETE FROM notes WHERE id = $1', [note.id]);
      });
      return { status: 204 };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/notes/:id/status',
    access: 'member',
    roles: ['head_of_product', 'product_manager'],
    resolve: resolveNote,
    handle: async (ctx, { principal, note }) => {
      const to = ctx.body.to;
      if (to !== 'processed' && to !== 'unprocessed') {
        failField('to', 'Status must be processed or unprocessed.');
      }
      if (!noteTransitionAllowed(note.status, to)) throw noteTransitionError(note.status, to);
      await withTransaction(async (client) => {
        await client.query('UPDATE notes SET status = $1, snoozed_until = NULL WHERE id = $2', [to, note.id]);
        await recordAudit(client, principal.workspaceId, principal.memberId, 'note.status', 'note', note.id, {
          to,
        });
      });
      const updated = await findNote(ctx.db, principal.workspaceId, note.id);
      return { status: 200, json: { note: updated } };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/notes/:id/snooze',
    access: 'member',
    roles: ['head_of_product', 'product_manager'],
    resolve: resolveNote,
    handle: async (ctx, { principal, note }) => {
      if (!noteSnoozeAllowed(note.status)) throw noteTransitionError(note.status, 'snoozed');
      const until = ctx.body.until;
      if (typeof until !== 'string' || !LOCAL_DATE_TIME.test(until)) {
        failField('until', 'Use a date and time like 2027-03-14T09:00.');
      }
      const instant = workspaceLocalToInstant(until, principal.timeZone);
      if (instant === null) failField('until', 'Use a date and time like 2027-03-14T09:00.');
      if (instant.getTime() <= Date.now()) failField('until', 'Pick a time in the future.');
      await withTransaction(async (client) => {
        await client.query("UPDATE notes SET status = 'snoozed', snoozed_until = $1 WHERE id = $2", [
          instant.toISOString(),
          note.id,
        ]);
        await recordAudit(client, principal.workspaceId, principal.memberId, 'note.snooze', 'note', note.id, {
          until: toInstant(instant),
        });
      });
      const updated = await findNote(ctx.db, principal.workspaceId, note.id);
      return { status: 200, json: { note: updated } };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/notes/:id/attachments',
    access: 'member',
    multipart: true,
    resolve: resolveNote,
    handle: async (ctx, { principal, note }) => {
      const file = parseMultipartFiles(ctx.rawBody, ctx.contentType).find((part) => part.field === 'file');
      if (!file) throw unsupportedMediaType();
      if (file.bytes.length > MAX_ATTACHMENT_BYTES) throw payloadTooLarge();
      const filename = displayFilename(file.filename);
      const extension = extensionOf(filename);
      if (extension === null) {
        throw new AppError(
          415,
          'unsupported_media_type',
          'Attach a .txt, .vtt, .pdf, .png or .jpg file.',
        );
      }
      if (!bytesMatchExtension(extension, file.bytes)) {
        failField('file', `${filename} is not a valid ${extension} file.`);
      }

      const attachmentId = newId();
      const objectKey = attachmentObjectKey(note.id, attachmentId, filename);
      const contentType = canonicalContentType(extension);
      let stored = true;
      try {
        await putObject(objectKey, file.bytes, contentType);
      } catch (error) {
        if (!(error instanceof StorageUnavailableError)) throw error;
        stored = false;
      }
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO attachments (id, note_id, filename, content_type, size, status, object_key, pending_bytes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            attachmentId,
            note.id,
            filename,
            contentType,
            file.bytes.length,
            stored ? 'available' : 'pending',
            objectKey,
            stored ? null : file.bytes,
          ],
        );
        await recordAudit(
          client,
          principal.workspaceId,
          principal.memberId,
          'attachment.create',
          'attachment',
          attachmentId,
          { status: stored ? 'available' : 'pending' },
        );
      });
      return {
        status: 201,
        json: {
          attachment: {
            id: attachmentId,
            filename,
            contentType,
            size: file.bytes.length,
            status: stored ? 'available' : 'pending',
          },
        },
      };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/attachments/:id',
    access: 'member',
    resolve: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const { rows } = await ctx.db.query<{
        id: string;
        filename: string;
        content_type: string;
        status: 'available' | 'pending';
        object_key: string;
      }>(
        `SELECT attachments.id, attachments.filename, attachments.content_type, attachments.status,
                attachments.object_key
           FROM attachments
           JOIN notes ON notes.id = attachments.note_id
          WHERE notes.workspace_id = $1 AND attachments.id = $2`,
        [principal.workspaceId, ctx.params.id],
      );
      return notFoundUnless(rows[0] ?? null);
    },
    handle: async (_ctx, attachment) => {
      if (attachment.status === 'pending') {
        throw conflict('attachment_pending', 'This attachment is still waiting to upload.');
      }
      const bytes = await getObject(attachment.object_key);
      if (bytes === null) throw notFound();
      return {
        status: 200,
        bytes,
        contentType: attachment.content_type,
        headers: { 'Content-Disposition': contentDisposition(attachment.filename) },
      };
    },
  });
}
