// Documents: file a certificate, review it, read it, download it. Uploads
// are judged by content, never by name or declared type. A failed store
// leaves no record.

import { Router } from 'express';
import { pool, newId } from '../db.js';
import {
  ApiError,
  asRecord,
  conflict,
  notFound,
  readRawBody,
  readJsonBody,
  requireOperator,
  requireString,
  requireUser,
  validationFailed,
} from '../http.js';
import { kitchenNow } from '../clock.js';
import { documentById, documentView, userById } from '../domain.js';
import { putObject, getObject, documentKey, StorageUnavailable } from '../storage.js';
import { runExpiryWarningChecks } from '../outbound.js';
import { MAX_FILE_BYTES, MAX_FILENAME_LENGTH, MAX_UPLOAD_BYTES } from '../../shared/constants.js';
import type { Document } from '../../shared/types.js';

export const router = Router();

const FILE_SIGNATURES: { type: string; head: number[] }[] = [
  { type: 'application/pdf', head: [0x25, 0x50, 0x44, 0x46] }, // %PDF-
  { type: 'image/png', head: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'image/jpeg', head: [0xff, 0xd8, 0xff] },
];

function detectType(bytes: Buffer): string | null {
  for (const sig of FILE_SIGNATURES) {
    if (sig.head.every((b, i) => bytes[i] === b)) return sig.type;
  }
  return null;
}

/** multipart/form-data, parsed by hand within the upload size limit. */
function parseMultipart(buffer: Buffer, boundary: string): Map<string, { value: string; filename?: string; bytes: Buffer }> {
  const fields = new Map<string, { value: string; filename?: string; bytes: Buffer }>();
  const delim = Buffer.from(`--${boundary}`);
  let index = buffer.indexOf(delim);
  while (index !== -1) {
    const start = index + delim.length;
    if (buffer.slice(start, start + 2).toString() === '\r\n') {
      const headerEnd = buffer.indexOf('\r\n\r\n', start);
      if (headerEnd === -1) break;
      const headers = buffer.slice(start + 2, headerEnd).toString('utf8');
      const next = buffer.indexOf(delim, headerEnd + 4);
      const bodyEnd = next === -1 ? buffer.length : next - 2;
      const body = buffer.slice(headerEnd + 4, bodyEnd);
      const nameMatch = /name="([^"]*)"/.exec(headers);
      const fileMatch = /filename="([^"]*)"/.exec(headers);
      if (nameMatch) {
        fields.set(nameMatch[1]!, {
          value: body.toString('utf8'),
          filename: fileMatch ? fileMatch[1]! : undefined,
          bytes: body,
        });
      }
      index = next;
    } else {
      index = buffer.indexOf(delim, start);
    }
  }
  return fields;
}

function badFilename(name: string): boolean {
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return true;
  if (name.length > MAX_FILENAME_LENGTH) return true;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(name)) return true;
  return false;
}

router.post('/documents', async (req, res, next) => {
  try {
    const user = await requireUser(req);
    const contentType = req.headers['content-type'] ?? '';
    const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
    if (!contentType.includes('multipart/form-data') || !boundaryMatch) {
      throw new ApiError(415, 'unsupported_media_type');
    }
    const raw = await readRawBody(req, MAX_UPLOAD_BYTES);
    const boundary = (boundaryMatch[1] ?? boundaryMatch[2])!.trim();
    const parts = parseMultipart(raw, boundary);

    const kindPart = parts.get('kind');
    const expiresPart = parts.get('expires_on');
    const cookPart = parts.get('crew_cook_id');
    const filePart = parts.get('file');
    const errors: Record<string, string> = {};
    const kind = kindPart?.value ?? '';
    if (kind !== 'liability_insurance' && kind !== 'food_handler_card') errors['kind'] = 'invalid';

    // A crew cook may upload only their own food handler card.
    if (user.role === 'crew_cook') {
      if (kind !== 'food_handler_card') throw new ApiError(403, 'forbidden');
      if (cookPart && cookPart.value !== user.id) throw new ApiError(403, 'forbidden');
    } else if (user.role !== 'member') {
      throw new ApiError(403, 'forbidden');
    }

    const expiresOn = expiresPart?.value ?? '';
    const today = kitchenNow().today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || !Number.isFinite(Date.parse(expiresOn + 'T00:00:00Z'))) {
      errors['expires_on'] = 'invalid';
    } else if (expiresOn < today) {
      errors['expires_on'] = 'already_expired';
    }

    let crewCookId: string | null = null;
    if (kind === 'food_handler_card') {
      const cookId = cookPart?.value ?? '';
      if (!cookId) {
        errors['crew_cook_id'] = 'required';
      } else {
        const cook = await userById(cookId);
        if (!cook || cook.role !== 'crew_cook') {
          errors['crew_cook_id'] = 'unknown';
        } else if (cook.member_id !== user.member_id) {
          errors['crew_cook_id'] = 'not_allowed';
        } else {
          crewCookId = cook.id;
        }
      }
    }
    if (!filePart || !filePart.filename) {
      errors['file'] = 'required';
    } else if (filePart.bytes.length === 0) {
      errors['file'] = 'empty';
    } else if (filePart.bytes.length > MAX_FILE_BYTES) {
      // A file part larger than 5,000,000 bytes answers file_too_large.
      throw new ApiError(413, 'file_too_large');
    } else if (badFilename(filePart.filename)) {
      errors['file'] = 'invalid_filename';
    }
    if (Object.keys(errors).length > 0) throw validationFailed(errors);

    const bytes = filePart!.bytes;
    const detected = detectType(bytes);
    if (!detected) throw new ApiError(415, 'unsupported_file_type');

    const id = newId('doc');
    const memberId = user.member_id!;
    try {
      await putObject(documentKey(memberId, id), bytes, detected);
    } catch (err) {
      if (err instanceof StorageUnavailable) throw new ApiError(503, 'storage_unavailable');
      throw err;
    }
    const now = kitchenNow().epochMillis;
    await pool.query(
      `INSERT INTO documents (id, member_id, kind, crew_cook_id, expires_on, status, filename, content_type, size_bytes, uploaded_at, reviewed_at, rejection_reason)
       VALUES ($1, $2, $3, $4, $5, 'uploaded', $6, $7, $8, $9, NULL, NULL)`,
      [id, memberId, kind, crewCookId, expiresOn, filePart!.filename!, detected, bytes.length, new Date(now)],
    );
    const row = await documentById(id);
    const cookName = crewCookId ? (await userById(crewCookId))?.name ?? null : null;
    res.status(201).json({ document: documentView(row!, cookName) });
  } catch (err) {
    next(err);
  }
});

function scopeDocument(user: { id: string; role: string; member_id: string | null }, doc: { member_id: string; crew_cook_id: string | null }): boolean {
  if (user.role === 'operator') return true;
  if (doc.member_id !== user.member_id) return false;
  if (user.role === 'crew_cook') return doc.crew_cook_id === user.id;
  return true;
}

router.get('/documents', async (req, res, next) => {
  try {
    const user = await requireUser(req);
    const statusFilter = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
    let rows;
    if (user.role === 'operator') {
      rows = await pool.query(`SELECT * FROM documents ORDER BY uploaded_at DESC`);
    } else if (user.role === 'crew_cook') {
      rows = await pool.query(
        `SELECT * FROM documents WHERE member_id = $1 AND crew_cook_id = $2 ORDER BY uploaded_at DESC`,
        [user.member_id, user.id],
      );
    } else {
      rows = await pool.query(`SELECT * FROM documents WHERE member_id = $1 ORDER BY uploaded_at DESC`, [user.member_id]);
    }
    const today = kitchenNow().today;
    const out: Document[] = [];
    for (const raw of rows.rows as unknown as RawDoc[]) {
      const row = toRow(raw);
      if (statusFilter && visibleStatus(row, today) !== statusFilter) continue;
      const cookName = row.crew_cook_id ? (await userById(row.crew_cook_id))?.name ?? null : null;
      out.push(documentView(row, cookName));
    }
    res.json({ documents: out });
  } catch (err) {
    next(err);
  }
});

interface RawDoc extends Record<string, unknown> {
  id: string;
  member_id: string;
  kind: Document['kind'];
  crew_cook_id: string | null;
  expires_on: string;
  status: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: Date;
  reviewed_at: Date | null;
  rejection_reason: string | null;
}

interface DocumentRowView {
  id: string;
  member_id: string;
  kind: Document['kind'];
  crew_cook_id: string | null;
  expires_on: string;
  status: Document['status'];
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at_epoch: number;
  reviewed_at_epoch: number | null;
  rejection_reason: string | null;
}

function toRow(raw: RawDoc): DocumentRowView {
  return {
    id: raw.id,
    member_id: raw.member_id,
    kind: raw.kind,
    crew_cook_id: raw.crew_cook_id,
    expires_on: raw.expires_on,
    status: raw.status as Document['status'],
    filename: raw.filename,
    content_type: raw.content_type,
    size_bytes: raw.size_bytes,
    uploaded_at_epoch: raw.uploaded_at.getTime(),
    reviewed_at_epoch: raw.reviewed_at ? raw.reviewed_at.getTime() : null,
    rejection_reason: raw.rejection_reason,
  };
}

function visibleStatus(row: { status: string; expires_on: string }, today: string): string {
  return row.status === 'approved' && row.expires_on < today ? 'expired' : row.status;
}

router.get('/documents/:id', async (req, res, next) => {
  try {
    const user = await requireUser(req);
    const row = await documentById(req.params['id']!);
    if (!row || !scopeDocument(user, row)) throw notFound();
    const cookName = row.crew_cook_id ? (await userById(row.crew_cook_id))?.name ?? null : null;
    const view = documentView(row, cookName);
    view.status = visibleStatus(row, kitchenNow().today) as Document['status'];
    res.json({ document: view });
  } catch (err) {
    next(err);
  }
});

router.get('/documents/:id/file', async (req, res, next) => {
  try {
    const user = await requireUser(req);
    const row = await documentById(req.params['id']!);
    if (!row || !scopeDocument(user, row)) throw notFound();
    let bytes: Buffer;
    try {
      bytes = await getObject(documentKey(row.member_id, row.id));
    } catch (err) {
      if (err instanceof StorageUnavailable) throw new ApiError(503, 'storage_unavailable');
      throw err;
    }
    res.set({
      'Content-Disposition': 'attachment',
      'Content-Type': row.content_type,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
    });
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

router.post('/documents/:id/approve', async (req, res, next) => {
  try {
    requireOperator(await requireUser(req));
    const row = await documentById(req.params['id']!);
    if (!row) throw notFound();
    if (row.status !== 'uploaded') throw conflict('invalid_transition');
    const now = new Date(kitchenNow().epochMillis);
    await pool.query(`UPDATE documents SET status = 'approved', reviewed_at = $1 WHERE id = $2`, [now, row.id]);
    // An approval can bring a document inside a warning window.
    await runExpiryWarningChecks(kitchenNow().today).catch(() => undefined);
    const fresh = await documentById(row.id);
    const cookName = fresh!.crew_cook_id ? (await userById(fresh!.crew_cook_id!))?.name ?? null : null;
    const view = documentView(fresh!, cookName);
    view.status = visibleStatus(fresh!, kitchenNow().today) as Document['status'];
    res.json({ document: view });
  } catch (err) {
    next(err);
  }
});

router.post('/documents/:id/reject', async (req, res, next) => {
  try {
    requireOperator(await requireUser(req));
    const row = await documentById(req.params['id']!);
    if (!row) throw notFound();
    if (row.status !== 'uploaded') throw conflict('invalid_transition');
    const body = asRecord(await readJsonBody(req));
    const reason = requireString(body, 'reason');
    if (reason.length < 1 || reason.length > 200) throw validationFailed({ reason: 'length' });
    const now = new Date(kitchenNow().epochMillis);
    await pool.query(`UPDATE documents SET status = 'rejected', reviewed_at = $1, rejection_reason = $2 WHERE id = $3`, [now, reason, row.id]);
    const fresh = await documentById(row.id);
    const cookName = fresh!.crew_cook_id ? (await userById(fresh!.crew_cook_id!))?.name ?? null : null;
    res.json({ document: documentView(fresh!, cookName) });
  } catch (err) {
    next(err);
  }
});
