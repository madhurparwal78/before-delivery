import { Router } from 'express';
import Busboy from 'busboy';
import type { Request } from 'express';
import type { DocumentType } from '../../../shared/types.js';
import { pool, query, queryOne, withTransaction } from '../../db/pool.js';
import {
  DOCUMENT_COLUMNS,
  documentState,
  documentView,
  type DocumentRow,
} from '../../domain/cover.js';
import { loadKitchen } from '../../domain/kitchens.js';
import { recordStateChange } from '../../domain/bookings.js';
import { newId } from '../../domain/secrets.js';
import { isValidDate, kitchenToday } from '../../domain/time.js';
import { serviceHealth, withService } from '../../services/health.js';
import { documentStorageKey, getDocumentFile, putDocumentFile } from '../../services/storage.js';
import { requireKitchen, requireMember, requireRole, requireUser } from '../access.js';
import { FILE_LIMIT, UPLOAD_LIMIT, created, ok, param, route } from '../context.js';
import { failures } from '../errors.js';

export const documentRoutes = Router();

const TYPES: DocumentType[] = ['insurance', 'food_handler', 'kitchen_agreement'];
const EXPIRING_TYPES: DocumentType[] = ['insurance', 'food_handler'];

/** The content type is judged from the file's first bytes. */
function detectContentType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes.subarray(1, 4).toString('latin1') === 'PNG' &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

function unsafeFileName(name: string): boolean {
  if (name.length === 0 || name.length > 200) return true;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return true;
  return /[\u0000-\u001f\u007f]/.test(name);
}

interface UploadParts {
  fields: Record<string, string>;
  fileName: string | null;
  fileBytes: Buffer | null;
  tooLarge: boolean;
}

async function readUpload(req: Request): Promise<UploadParts> {
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw failures.unsupportedMediaType();
  }
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > UPLOAD_LIMIT) throw failures.payloadTooLarge();

  return new Promise<UploadParts>((resolve, reject) => {
    const parts: UploadParts = { fields: {}, fileName: null, fileBytes: null, tooLarge: false };
    const busboy = Busboy({
      headers: req.headers,
      preservePath: true,
      limits: { fields: 12, files: 1, fileSize: FILE_LIMIT + 1, fieldSize: 4096 },
    });
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > UPLOAD_LIMIT) {
        req.unpipe(busboy);
        reject(failures.payloadTooLarge());
      }
    });
    busboy.on('field', (name, value) => {
      parts.fields[name] = value;
    });
    busboy.on('file', (_name, stream, info) => {
      parts.fileName = info.filename ?? null;
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => {
        parts.tooLarge = true;
      });
      stream.on('end', () => {
        parts.fileBytes = Buffer.concat(chunks);
      });
    });
    busboy.on('close', () => resolve(parts));
    busboy.on('error', () => reject(failures.unsupportedMediaType()));
    req.pipe(busboy);
  });
}

documentRoutes.post(
  '/documents',
  route(
    async (ctx) => {
      const parts = await readUpload(ctx.req);
      const user = requireUser(ctx.user);
      const kitchen = await requireKitchen(pool, user, user.kitchen_id);

      const requestedType = parts.fields.type;
      const type = TYPES.find((candidate) => candidate === requestedType) ?? null;
      const member =
        user.role === 'member'
          ? await requireMember(pool, user, user.member_id ?? '')
          : await requireMember(pool, user, parts.fields.member_id ?? '');
      requireRole(user, 'operator', 'member');
      if (user.role === 'member' && type === 'kitchen_agreement') throw failures.forbidden();

      if (parts.tooLarge) throw failures.fileTooLarge();

      const today = kitchenToday(kitchen.timezone, ctx.now);
      const errors: Record<string, string> = {};
      if (type === null) errors.type = 'Choose a document type.';
      const expiresRaw = parts.fields.expires_on;
      let expiresOn: string | null = null;
      if (type !== null && EXPIRING_TYPES.includes(type)) {
        if (!isValidDate(expiresRaw) || expiresRaw < today) {
          errors.expires_on = 'Choose an expiry date from today onward.';
        } else {
          expiresOn = expiresRaw;
        }
      } else if (expiresRaw !== undefined && expiresRaw !== '') {
        errors.expires_on = 'A signed kitchen-use agreement has no expiry date.';
      }
      if (parts.fileName === null || unsafeFileName(parts.fileName)) {
        errors.file = 'That file name is not allowed.';
      } else if (parts.fileBytes === null || parts.fileBytes.byteLength === 0) {
        errors.file = 'Choose a file with contents.';
      }
      if (Object.keys(errors).length > 0) throw failures.validation(errors);

      const bytes = parts.fileBytes;
      if (bytes === null) throw failures.validation({ file: 'Choose a file with contents.' });
      const contentType = detectContentType(bytes);
      if (contentType === null) throw failures.unsupportedType();
      if (serviceHealth('files') === 'down') throw failures.filesUnavailable();

      const id = newId('doc');
      const key = documentStorageKey(kitchen.id, member.id, id);
      await withService('files', () => putDocumentFile(key, bytes, contentType)).catch(() => {
        throw failures.filesUnavailable();
      });

      const row = await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO documents
             (id, kitchen_id, member_id, type, state, expires_on, original_name, size_bytes,
              content_type, uploaded_at, reject_reason, storage_key, file_stored)
           VALUES ($1, $2, $3, $4, 'uploaded', $5, $6, $7, $8, $9, NULL, $10, true)`,
          [
            id,
            kitchen.id,
            member.id,
            type,
            expiresOn,
            parts.fileName,
            bytes.byteLength,
            contentType,
            ctx.now,
            key,
          ],
        );
        await recordStateChange(client, {
          actorId: user.id,
          kitchenId: kitchen.id,
          subject: 'document',
          subjectId: id,
          from: null,
          to: 'uploaded',
          now: ctx.now,
        });
        return queryOne<DocumentRow>(
          client,
          `SELECT ${DOCUMENT_COLUMNS} FROM documents d WHERE d.id = $1`,
          [id],
        );
      });
      if (!row) throw failures.notFound();
      return created({ document: documentView(row, today) });
    },
    { parseBody: false },
  ),
);

documentRoutes.get(
  '/documents',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const kitchen = await requireKitchen(pool, user, user.kitchen_id);
    requireRole(user, 'operator', 'member');
    const today = kitchenToday(kitchen.timezone, ctx.now);
    const rows =
      user.role === 'member'
        ? await query<DocumentRow>(
            pool,
            `SELECT ${DOCUMENT_COLUMNS}, m.business FROM documents d
               JOIN members m ON m.id = d.member_id
              WHERE d.member_id = $1 ORDER BY d.uploaded_at DESC`,
            [user.member_id],
          )
        : await query<DocumentRow>(
            pool,
            `SELECT ${DOCUMENT_COLUMNS}, m.business FROM documents d
               JOIN members m ON m.id = d.member_id
              WHERE d.kitchen_id = $1 ORDER BY d.uploaded_at DESC`,
            [kitchen.id],
          );
    return ok({ documents: rows.map((row) => documentView(row, today)) });
  }),
);

async function requireDocument(
  user: { role: string; kitchen_id: string; member_id: string | null },
  documentId: string,
): Promise<DocumentRow> {
  const row = await queryOne<DocumentRow>(
    pool,
    `SELECT ${DOCUMENT_COLUMNS}, m.business FROM documents d
       JOIN members m ON m.id = d.member_id WHERE d.id = $1`,
    [documentId],
  );
  if (!row || row.kitchen_id !== user.kitchen_id) throw failures.notFound();
  if (user.role === 'member' && row.member_id !== user.member_id) throw failures.notFound();
  return row;
}

documentRoutes.get(
  '/documents/:document_id',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const row = await requireDocument(user, param(ctx.req, 'document_id'));
    requireRole(user, 'operator', 'member');
    const kitchen = await loadKitchen(pool, row.kitchen_id);
    if (!kitchen) throw failures.notFound();
    return ok({ document: documentView(row, kitchenToday(kitchen.timezone, ctx.now)) });
  }),
);

documentRoutes.get(
  '/documents/:document_id/file',
  route(async (ctx) => {
    const user = requireUser(ctx.user);
    const row = await requireDocument(user, param(ctx.req, 'document_id'));
    requireRole(user, 'operator', 'member');
    if (serviceHealth('files') === 'down') throw failures.filesUnavailable();
    const bytes = await withService('files', () => getDocumentFile(row.storage_key)).catch(() => {
      throw failures.filesUnavailable();
    });
    ctx.res
      .status(200)
      .setHeader('Content-Type', row.content_type);
    ctx.res.setHeader(
      'Content-Disposition',
      `attachment; filename="${row.original_name.replace(/"/g, '')}"`,
    );
    ctx.res.setHeader('X-Content-Type-Options', 'nosniff');
    ctx.res.send(bytes);
    return null;
  }),
);

function reviewRoute(target: 'verified' | 'rejected') {
  return route(async (ctx) => {
    const user = requireUser(ctx.user);
    const row = await requireDocument(user, param(ctx.req, 'document_id'));
    requireRole(user, 'operator');
    const kitchen = await loadKitchen(pool, row.kitchen_id);
    if (!kitchen) throw failures.notFound();
    const today = kitchenToday(kitchen.timezone, ctx.now);

    let reason: string | null = null;
    if (target === 'rejected') {
      const raw = ctx.body.reason;
      if (typeof raw !== 'string' || raw.trim().length < 1 || raw.length > 300) {
        throw failures.validation({ reason: 'Give a reason of 1 to 300 characters.' });
      }
      reason = raw.trim();
    }

    const current = documentState(row, today);
    if (current !== 'uploaded') throw failures.invalidTransition(current, target);

    const updated = await withTransaction(async (client) => {
      const fresh = await queryOne<DocumentRow>(
        client,
        `SELECT ${DOCUMENT_COLUMNS} FROM documents d WHERE d.id = $1 FOR UPDATE`,
        [row.id],
      );
      if (!fresh) throw failures.notFound();
      const freshState = documentState(fresh, today);
      if (freshState !== 'uploaded') throw failures.invalidTransition(freshState, target);
      await client.query('UPDATE documents SET state = $2, reject_reason = $3 WHERE id = $1', [
        row.id,
        target,
        reason,
      ]);
      await recordStateChange(client, {
        actorId: user.id,
        kitchenId: kitchen.id,
        subject: 'document',
        subjectId: row.id,
        from: 'uploaded',
        to: target,
        now: ctx.now,
      });
      return { ...fresh, state: target, reject_reason: reason, business: row.business };
    });
    return ok({ document: documentView(updated, today) });
  });
}

documentRoutes.post('/documents/:document_id/verify', reviewRoute('verified'));
documentRoutes.post('/documents/:document_id/reject', reviewRoute('rejected'));
