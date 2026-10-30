import { MAX_UPLOAD_BYTES } from '../../../shared/domain.js';
import { isValidDate } from '../../../shared/time.js';
import { documentStorageKey, newId } from '../../db/seed.js';
import {
  detectContentType,
  documentView,
  findDocument,
  isAcceptableFilename,
  listDocuments,
  type DocumentRow,
} from '../../domain/documents.js';
import { sendExpiryWarnings } from '../../domain/sweeps.js';
import { parseMultipart } from '../boundary.js';
import { requireUser, type RequestContext } from '../context.js';
import { HttpError, conflict, invalidField, notFound } from '../errors.js';
import { route, type Route } from '../router.js';
import { requireBoundedText } from '../validate.js';

const DOWNLOAD_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': 'sandbox',
  'Cache-Control': 'no-store',
};

/** Documents outside the caller's scope answer 404, exactly as unknown ids do. */
async function resolveVisibleDocument(ctx: RequestContext): Promise<DocumentRow> {
  const document = await findDocument(ctx.app.db, ctx.req.params['id'] as string);
  if (document === null) throw notFound();
  const user = requireUser(ctx);
  if (user.role === 'operator') return document;
  if (user.role === 'member' && document.member_id === user.member_id) return document;
  if (user.role === 'crew_cook' && document.crew_cook_id === user.id) return document;
  throw notFound();
}

async function uploadDocument(ctx: RequestContext): Promise<{ status: number; body: unknown }> {
  const user = requireUser(ctx);
  const form = await parseMultipart(ctx.req, ctx.rawBody);

  const kind = form.fields['kind'];
  if (kind !== 'liability_insurance' && kind !== 'food_handler_card') {
    throw invalidField('kind', 'invalid');
  }
  // A crew cook may upload only a food handler card for themselves.
  if (user.role === 'crew_cook' && kind !== 'food_handler_card') throw new HttpError(403, 'forbidden');

  const expiresOn = form.fields['expires_on'];
  if (expiresOn === undefined || !isValidDate(expiresOn)) throw invalidField('expires_on', 'invalid');
  if (expiresOn < ctx.today) throw invalidField('expires_on', 'already_expired');

  let crewCookId: string | null = null;
  if (kind === 'food_handler_card') {
    const asked = user.role === 'crew_cook' ? (form.fields['crew_cook_id'] ?? user.id) : form.fields['crew_cook_id'];
    if (asked === undefined || asked === '') throw invalidField('crew_cook_id', 'required');
    const found = await ctx.app.db.query<{ id: string; role: string; member_id: string | null }>(
      'SELECT id, role, member_id FROM users WHERE id = $1',
      [asked],
    );
    const cook = found.rows[0];
    if (cook === undefined || cook.role !== 'crew_cook') throw invalidField('crew_cook_id', 'unknown');
    if (user.role === 'crew_cook' && cook.id !== user.id) throw invalidField('crew_cook_id', 'not_allowed');
    if (user.role === 'member' && cook.member_id !== user.member_id) {
      throw invalidField('crew_cook_id', 'not_allowed');
    }
    crewCookId = cook.id;
  }

  const file = form.file;
  if (file === null || !file.present) throw invalidField('file', 'required');
  if (!isAcceptableFilename(file.filename)) throw invalidField('file', 'invalid_filename');
  if (file.truncated || file.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, 'file_too_large');
  }
  if (file.bytes.byteLength === 0) throw invalidField('file', 'empty');
  const contentType = detectContentType(file.bytes);
  if (contentType === null) throw new HttpError(415, 'unsupported_file_type');

  const memberId = user.member_id;
  if (memberId === null) throw new HttpError(403, 'forbidden');

  // A document counts as on file only once its object is stored, so a failed
  // store leaves no record behind.
  const id = newId('doc');
  const key = documentStorageKey(memberId, id);
  await ctx.app.storage.putObject(key, file.bytes, contentType);

  await ctx.app.db.query(
    `INSERT INTO documents (id, member_id, kind, crew_cook_id, expires_on, status, filename,
        content_type, size_bytes, storage_key, uploaded_at)
     VALUES ($1, $2, $3, $4, $5, 'uploaded', $6, $7, $8, $9, $10)`,
    [
      id,
      memberId,
      kind,
      crewCookId,
      expiresOn,
      file.filename,
      contentType,
      file.bytes.byteLength,
      key,
      ctx.now,
    ],
  );

  const stored = await findDocument(ctx.app.db, id);
  return {
    status: 201,
    body: { document: documentView(stored as DocumentRow, ctx.today, ctx.app.config.timeZone) },
  };
}

export const documentRoutes: Route[] = [
  route({
    method: 'POST',
    path: '/documents',
    roles: ['member', 'crew_cook'],
    upload: true,
    handle: uploadDocument,
  }),

  route({
    method: 'GET',
    path: '/documents',
    handle: async (ctx) => {
      const user = requireUser(ctx);
      const scope =
        user.role === 'operator'
          ? {}
          : user.role === 'member'
            ? { memberId: user.member_id as string }
            : { crewCookId: user.id };
      const wanted = ctx.req.query['status'];
      let rows = await listDocuments(ctx.app.db, scope);
      if (typeof wanted === 'string' && wanted !== '') {
        rows = rows.filter(
          (row) =>
            documentView(row, ctx.today, ctx.app.config.timeZone).status === wanted,
        );
      }
      return {
        status: 200,
        body: {
          documents: rows.map((row) => documentView(row, ctx.today, ctx.app.config.timeZone)),
        },
      };
    },
  }),

  route<DocumentRow>({
    method: 'GET',
    path: '/documents/:id',
    resolve: resolveVisibleDocument,
    handle: async (ctx, document) => ({
      status: 200,
      body: { document: documentView(document, ctx.today, ctx.app.config.timeZone) },
    }),
  }),

  route<DocumentRow>({
    method: 'GET',
    path: '/documents/:id/file',
    resolve: resolveVisibleDocument,
    handle: async (ctx, document) => {
      const stored = await ctx.app.storage.getObject(document.storage_key);
      if (stored === null) throw notFound();
      return {
        status: 200,
        buffer: stored.body,
        headers: {
          ...DOWNLOAD_HEADERS,
          'Content-Type': document.content_type,
          'Content-Disposition': `attachment; filename="${document.id}"`,
        },
      };
    },
  }),

  route<DocumentRow>({
    method: 'POST',
    path: '/documents/:id/approve',
    roles: ['operator'],
    resolve: resolveVisibleDocument,
    handle: async (ctx, document) => {
      const updated = await ctx.app.db.query(
        `UPDATE documents SET status = 'approved', reviewed_at = $2, rejection_reason = NULL
          WHERE id = $1 AND status = 'uploaded'`,
        [document.id, ctx.now],
      );
      if (updated.rowCount === 0) throw conflict('invalid_transition');
      // Warnings are also judged immediately after an approval.
      await sendExpiryWarnings(ctx.app.db, ctx.today, ctx.now);
      const stored = await findDocument(ctx.app.db, document.id);
      return {
        status: 200,
        body: {
          document: documentView(stored as DocumentRow, ctx.today, ctx.app.config.timeZone),
        },
      };
    },
  }),

  route<DocumentRow>({
    method: 'POST',
    path: '/documents/:id/reject',
    roles: ['operator'],
    resolve: resolveVisibleDocument,
    handle: async (ctx, document) => {
      const reason = requireBoundedText(ctx.body, 'reason', 1, 200);
      const updated = await ctx.app.db.query(
        `UPDATE documents SET status = 'rejected', reviewed_at = $2, rejection_reason = $3
          WHERE id = $1 AND status = 'uploaded'`,
        [document.id, ctx.now, reason],
      );
      if (updated.rowCount === 0) throw conflict('invalid_transition');
      const stored = await findDocument(ctx.app.db, document.id);
      return {
        status: 200,
        body: {
          document: documentView(stored as DocumentRow, ctx.today, ctx.app.config.timeZone),
        },
      };
    },
  }),
];
