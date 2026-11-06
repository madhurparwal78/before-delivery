import type { AuthedRequest } from '../api-core.js';
import { callerOf, forbidden } from '../api-core.js';
import { ApiError, documentStatusWord } from '../errors.js';
import { withContentionRetry } from '../db.js';
import { type Handler, type RouteContext } from '../pipeline.js';
import { formatInstant, todayInZone, addDays } from '../time.js';
import { documentObject } from '../serialize.js';
import { currentDocument, documentTypeName, type DocumentRow, type DocumentType } from '../documents.js';
import { detectContentType, newId, normaliseText, codePoints, sanitiseFileName } from '../util.js';
import type { PoolClient } from 'pg';
import type { Response } from 'express';

const nowDate = (): Date => new Date();

const DOC_TYPES: DocumentType[] = ['insurance_certificate', 'food_handler_card'];

async function businessOf(client: PoolClient, memberId: string): Promise<string> {
  const row = await client.query<{ business_name: string }>(`SELECT business_name FROM members WHERE id=$1`, [memberId]);
  return row.rows[0].business_name;
}

async function memberInKitchen(client: PoolClient, kitchenId: string, memberId: string): Promise<boolean> {
  const row = await client.query<{ id: string }>(`SELECT id FROM members WHERE id=$1 AND kitchen_id=$2`, [memberId, kitchenId]);
  return row.rows.length > 0;
}

async function documentShape(client: PoolClient, doc: DocumentRow, today: string): Promise<Record<string, unknown>> {
  const obj = documentObject(doc, await businessOf(client, doc.member_id), today);
  // current: the approved document with the latest expiry date of its type.
  const current = await currentDocument(client, doc.member_id, doc.type, today);
  obj.current = current?.row.id === doc.id;
  return obj;
}

// ---------------------------------------------------------------------------
// POST /api/documents — multipart upload
// ---------------------------------------------------------------------------
export const uploadDocument: Handler = async (req, res, ctx) => {
  const caller = callerOf(req);
  if (caller.person.role !== 'member' || !caller.person.member_id) throw forbidden();
  const parts = (req as AuthedRequest & { fileParts?: Map<string, { fileName: string; data: Buffer }>; fields?: Map<string, string> }).fileParts;
  const fields = (req as AuthedRequest & { fields?: Map<string, string> }).fields;
  const type = fields?.get('type');
  const expiryDate = fields?.get('expiryDate');
  const file = parts?.get('file');
  const errors: Record<string, string> = {};
  if (type !== 'insurance_certificate' && type !== 'food_handler_card') errors.type = 'Choose insurance certificate or food-handler card.';
  if (!expiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) errors.expiryDate = 'Enter an expiry date of today or later.';
  else {
    const today = todayInZone(nowDate(), caller.kitchen.time_zone);
    if (expiryDate < today) errors.expiryDate = 'Enter an expiry date of today or later.';
  }
  if (!file) errors.file = 'Choose a file to upload.';
  // The file-type check comes before the field checks.
  let contentType: string | null = null;
  if (file) {
    contentType = detectContentType(file.data);
    if (!contentType) throw new ApiError('unsupported_file_type');
  }
  if (Object.keys(errors).length > 0) throw new ApiError('validation_failed', { errors });

  await withContentionRetry(async (client) => {
    const instant = nowDate();
    const docId = newId('doc');
    // Supersede older submitted documents of the same type; uploads of one
    // member and type are settled one at a time.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`,
      [caller.person.member_id, type],
    );
    const superseded = await client.query<{ id: string }>(
      `SELECT id FROM documents WHERE member_id=$1 AND type=$2 AND superseded=false AND approved_at IS NULL`,
      [caller.person.member_id, type],
    );
    for (const row of superseded.rows) {
      await client.query(`UPDATE documents SET superseded=true, version=version+1 WHERE id=$1`, [row.id]);
    }
    await client.query(
      `INSERT INTO documents (id, kitchen_id, member_id, type, expiry_date, file_name, content_type, size_bytes, uploaded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [docId, caller.kitchen.id, caller.person.member_id, type, expiryDate, file!.fileName, contentType, file!.data.length, instant],
    );
    // Record and object exist together or not at all: store the object, and
    // delete it if the record insert failed (the insert above would throw).
    try {
      await ctx.storage.put(
        `kitchens/${caller.kitchen.id}/members/${caller.person.member_id}/documents/${docId}`,
        file!.data,
        contentType!,
      );
    } catch (err) {
      await client.query(`DELETE FROM documents WHERE id=$1`, [docId]);
      throw new ApiError('storage_unavailable', {}, (n) => (n === 'storageKind' ? 'upload' : ''));
    }
    const doc = (await client.query<DocumentRow>(`SELECT * FROM documents WHERE id=$1`, [docId])).rows[0];
    const today = todayInZone(instant, caller.kitchen.time_zone);
    res.status(201).json({ document: await documentShape(client, doc, today) });
  });
};

// ---------------------------------------------------------------------------
// GET /api/documents?memberId=
// ---------------------------------------------------------------------------
export const listDocuments: Handler = async (req, res) => {
  const caller = callerOf(req);
  const memberId = caller.person.role === 'member' ? caller.person.member_id : (req.query.memberId as string | undefined) ?? null;
  await withContentionRetry(async (client) => {
    const instant = nowDate();
    const today = todayInZone(instant, caller.kitchen.time_zone);
    let docs: DocumentRow[];
    if (memberId) {
      if (!(await memberInKitchen(client, caller.kitchen.id, memberId))) throw new ApiError('not_found');
      docs = (await client.query<DocumentRow>(`SELECT * FROM documents WHERE member_id=$1 ORDER BY uploaded_at DESC, id`, [memberId])).rows;
    } else {
      docs = (await client.query<DocumentRow>(`SELECT * FROM documents WHERE kitchen_id=$1 ORDER BY uploaded_at DESC, id`, [caller.kitchen.id])).rows;
    }
    const out = [];
    for (const doc of docs) out.push(await documentShape(client, doc, today));
    res.status(200).json({ documents: out });
  });
};

// ---------------------------------------------------------------------------
// GET /api/documents/{id}
// ---------------------------------------------------------------------------
export const getDocument: Handler = async (req, res) => {
  const caller = callerOf(req);
  const id = String(req.params.id);
  await withContentionRetry(async (client) => {
    const doc = (await client.query<DocumentRow>(`SELECT * FROM documents WHERE id=$1`, [id])).rows[0];
    if (!doc || doc.kitchen_id !== caller.kitchen.id) throw new ApiError('not_found');
    if (caller.person.role === 'member' && doc.member_id !== caller.person.member_id) throw new ApiError('not_found');
    const today = todayInZone(nowDate(), caller.kitchen.time_zone);
    res.status(200).json({ document: await documentShape(client, doc, today) });
  });
};

// ---------------------------------------------------------------------------
// GET /api/documents/{id}/file — safe document delivery
// ---------------------------------------------------------------------------
export const downloadDocument: Handler = async (req, res, ctx) => {
  const caller = callerOf(req);
  const id = String(req.params.id);
  const doc = (await withContentionRetry(async (client) => {
    const row = (await client.query<DocumentRow>(`SELECT * FROM documents WHERE id=$1`, [id])).rows[0];
    if (!row || row.kitchen_id !== caller.kitchen.id) throw new ApiError('not_found');
    if (caller.person.role === 'member' && row.member_id !== caller.person.member_id) throw new ApiError('not_found');
    return row;
  }))!;
  let bytes: Buffer;
  try {
    bytes = (await ctx.storage.get(`kitchens/${caller.kitchen.id}/members/${doc.member_id}/documents/${doc.id}`))!;
  } catch {
    throw new ApiError('storage_unavailable', {}, (n) => (n === 'storageKind' ? 'download' : ''));
  }
  if (!bytes) throw new ApiError('not_found');
  sendFileBytes(res, bytes, doc.content_type, doc.file_name);
};

export function sendFileBytes(res: Response, bytes: Buffer, contentType: string, fileName: string): void {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${sanitiseFileName(fileName)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).end(bytes);
}

// ---------------------------------------------------------------------------
// POST /api/documents/{id}/approve
// ---------------------------------------------------------------------------
export const approveDocument: Handler = async (req, res) => {
  const caller = callerOf(req);
  if (caller.person.role !== 'operator') throw forbidden();
  const id = String(req.params.id);
  const body = (await import('../pipeline.js')).parseJsonBody(req.rawBody) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (key !== 'version') errors[key] = 'This field cannot be set.';
  }
  const version = Number(body.version);
  if (!Number.isInteger(version)) errors.version = 'Reload and try again.';
  if (Object.keys(errors).length > 0) throw new ApiError('validation_failed', { errors });
  await withContentionRetry(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`, [id, 'approve']);
    const doc = (await client.query<DocumentRow>(`SELECT * FROM documents WHERE id=$1`, [id])).rows[0];
    if (!doc || doc.kitchen_id !== caller.kitchen.id) throw new ApiError('not_found');
    const instant = nowDate();
    const today = todayInZone(instant, caller.kitchen.time_zone);
    const shape = await documentShape(client, doc, today);
    if (doc.superseded) {
      const newer = await client.query<{ id: string }>(
        `SELECT id FROM documents WHERE member_id=$1 AND type=$2 AND superseded=false AND approved_at IS NULL ORDER BY uploaded_at DESC LIMIT 1`,
        [doc.member_id, doc.type],
      );
      const business = await businessOf(client, doc.member_id);
      throw new ApiError(
        'document_superseded',
        { current: shape, supersededBy: newer.rows[0]?.id ?? doc.id },
        (n) => (n === 'documentType' ? documentTypeName(doc.type) : n === 'business' ? business : ''),
      );
    }
    if (version !== doc.version) {
      throw new ApiError('stale_version', { current: shape }, (n) => (n === 'action' ? 'document' : ''));
    }
    if (doc.approved_at !== null) {
      throw new ApiError(
        'invalid_transition',
        { from: doc.status, action: 'approve', current: shape },
        (n) => (n === 'statusWord' ? documentStatusWord(String((shape as { status: string }).status)) : ''),
        `That action is not available for a ${documentStatusWord(String((shape as { status: string }).status))} document.`,
      );
    }
    await client.query(`UPDATE documents SET approved_at=$2, status='approved', version=version+1 WHERE id=$1`, [id, instant]);
    const updated = (await client.query<DocumentRow>(`SELECT * FROM documents WHERE id=$1`, [id])).rows[0];
    // Expiry notices go only for current documents, checked at approval.
    await checkExpiryNotices(client, caller.kitchen.id, updated.member_id, caller.kitchen.time_zone);
    res.status(200).json({ document: await documentShape(client, updated, today) });
  });
};

/** The notice ladder: 14-day and 3-day notices, at most once per document. */
export async function checkExpiryNotices(client: PoolClient, kitchenId: string, memberId: string | null, timeZone: string): Promise<void> {
  const instant = nowDate();
  const today = todayInZone(instant, timeZone);
  const members = memberId
    ? [{ id: memberId }]
    : (await client.query<{ id: string }>(`SELECT id FROM members WHERE kitchen_id=$1`, [kitchenId])).rows;
  for (const member of members) {
    for (const type of DOC_TYPES) {
      const current = await currentDocument(client, member.id, type, today);
      if (!current) continue;
      const days = current.daysRemaining;
      if (days < 0) continue;
      const notices: ('14-day' | '3-day')[] = [];
      if (days <= 14 && days >= 4) notices.push('14-day');
      if (days <= 3 && days >= 0) notices.push('3-day');
      for (const notice of notices) {
        const already = await client.query<{ document_id: string }>(
          `SELECT document_id FROM expiry_notices WHERE document_id=$1 AND kind=$2`,
          [current.row.id, notice],
        );
        if (already.rows.length > 0) continue;
        const emailRow = await client.query<{ email: string }>(
          `SELECT p.email FROM people p JOIN members m ON m.person_id=p.id WHERE m.id=$1`,
          [member.id],
        );
        if (emailRow.rows.length === 0) continue;
        await client.query(`INSERT INTO expiry_notices (document_id, kind) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [current.row.id, notice]);
        const subject =
          notice === '14-day'
            ? `14-day notice: your ${documentTypeName(type)} expires on ${current.row.expiry_date}`
            : `3-day notice: your ${documentTypeName(type)} expires on ${current.row.expiry_date}`;
        const body = `${documentTypeName(type)}: ${current.row.expiry_date}`;
        await client.query(`INSERT INTO outbox (id, kind, payload) VALUES ($1,'mail',$2::jsonb)`, [
          newId('out'),
          JSON.stringify({ kind: 'mail', to: emailRow.rows[0].email, subject, body }),
        ]);
      }
    }
  }
}

export { documentStatusWord };
