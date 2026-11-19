import { createHash, randomUUID } from 'node:crypto';
import { iso, nowMs } from '../clock';
import { query, tx } from '../db';
import { ApiError, isUuid, validationError } from '../http/errors';
import type { HandlerResult, RequestContext } from '../http/context';
import { memberById, memberByUser, validThroughFor, type MemberRecord } from '../domain/members';
import { localDateOf, isDate } from '../../shared/tz';
import type { DocumentJson, DocumentStatus, DocumentType } from '../../shared/types';
import { StorageUnavailable, deleteObject, getObject, headObject, putObject } from '../services/s3';
import type { MultipartFile } from '../http/request';

const DOCUMENT_TYPES: DocumentType[] = [
  'certificate_of_insurance',
  'food_handler_certificate',
  'business_licence',
];

const SIGNATURES: { type: string; matches: (bytes: Buffer) => boolean }[] = [
  { type: 'application/pdf', matches: (bytes) => bytes.slice(0, 5).toString('latin1') === '%PDF-' },
  {
    type: 'image/png',
    matches: (bytes) =>
      bytes.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    type: 'image/jpeg',
    matches: (bytes) =>
      bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
];

/** The declared part type and the leading bytes must agree on one accepted type. */
export function detectedType(file: MultipartFile): string | null {
  const declared = (file.contentType.split(';')[0] ?? '').trim().toLowerCase();
  const signature = SIGNATURES.find((candidate) => candidate.type === declared);
  if (signature === undefined) return null;
  return signature.matches(file.bytes) ? declared : null;
}

/** The submitted name is display text only. */
export function displayFileName(submitted: string): string {
  const lastSegment = submitted.split(/[/\\]/).pop() ?? '';
  const cleaned = lastSegment.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return cleaned.length === 0 ? 'file' : cleaned;
}

interface DocumentRow {
  id: string;
  member_id: string;
  doc_type: DocumentType;
  expiry_date: string;
  status: DocumentStatus;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  rejection_reason: string | null;
  created_at: Date;
  storage_key: string;
  business_name: string;
  tenant_id: string;
  home_site_id: string;
}

const DOCUMENT_SELECT = `
  select d.id, d.member_id, d.doc_type, to_char(d.expiry_date, 'YYYY-MM-DD') as expiry_date,
         d.status, d.file_name, d.content_type, d.size_bytes, d.sha256, d.rejection_reason,
         d.created_at, d.storage_key, m.business_name, d.tenant_id, m.home_site_id
    from documents d join members m on m.id = d.member_id`;

function documentJson(row: DocumentRow): DocumentJson {
  return {
    id: row.id,
    member_id: row.member_id,
    type: row.doc_type,
    expiry_date: row.expiry_date,
    status: row.status,
    file_name: row.file_name,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    sha256: row.sha256,
    rejection_reason: row.rejection_reason,
    created_at: iso(row.created_at),
  };
}

async function requireMember(ctx: RequestContext): Promise<MemberRecord> {
  const user = ctx.requireUser();
  const member = await memberByUser(user.user_id);
  if (member === null) throw new ApiError('forbidden');
  return member;
}

export async function postDocument(ctx: RequestContext): Promise<HandlerResult> {
  const member = await requireMember(ctx);
  const form = ctx.multipart();
  const file = form.files.find((candidate) => candidate.fieldName === 'file');
  if (file !== undefined && file.bytes.length > 0) {
    if (detectedType(file) === null) throw new ApiError('unsupported_type');
  }
  const rawType = form.fields.type ?? '';
  const isInsurance = rawType === 'certificate_of_insurance';
  const allowed = isInsurance
    ? ['type', 'expiry_date', 'file', 'per_occurrence_limit', 'names_additional_insured']
    : ['type', 'expiry_date', 'file'];
  const unknown = form.fieldNames.filter((name) => !allowed.includes(name));
  if (unknown.length > 0) {
    const fields: Record<string, string> = {};
    for (const name of unknown) fields[name] = 'Unknown field.';
    throw validationError(fields);
  }
  if (!DOCUMENT_TYPES.includes(rawType as DocumentType)) {
    throw validationError({ type: 'Choose a document type.' });
  }
  const documentType = rawType as DocumentType;
  const expiryDate = form.fields.expiry_date ?? '';
  if (!isDate(expiryDate)) {
    throw validationError({ expiry_date: 'Enter the expiry date shown on the document.' });
  }
  if (isInsurance) {
    const limit = Number.parseInt(form.fields.per_occurrence_limit ?? '', 10);
    if (!Number.isInteger(limit) || limit < 1000000) {
      throw validationError({
        per_occurrence_limit: 'Coverage must be at least $1,000,000 per occurrence.',
      });
    }
    if ((form.fields.names_additional_insured ?? '') !== 'true') {
      throw validationError({
        names_additional_insured: 'The certificate must name the incubator as additional insured.',
      });
    }
  }
  if (file === undefined || file.bytes.length === 0) {
    throw validationError({ file: 'Choose a file to upload.' });
  }
  const contentType = detectedType(file) as string;
  const documentId = randomUUID();
  const sha256 = createHash('sha256').update(file.bytes).digest('hex');
  const storageKey = `documents/${member.tenant_id}/${member.id}/${documentId}`;
  try {
    await putObject(storageKey, file.bytes, contentType, {
      sha256,
      'document-id': documentId,
    });
    const head = await headObject(storageKey);
    if (
      head.contentLength !== file.bytes.length ||
      head.contentType !== contentType ||
      head.metadata.sha256 !== sha256 ||
      head.metadata['document-id'] !== documentId
    ) {
      throw new StorageUnavailable('stored object did not match');
    }
  } catch (error) {
    await deleteObject(storageKey).catch(() => undefined);
    if (error instanceof StorageUnavailable) throw new ApiError('storage_unavailable');
    throw error;
  }
  const createdAt = nowMs();
  await query(
    `insert into documents (id, tenant_id, member_id, doc_type, expiry_date, status, file_name,
       content_type, size_bytes, sha256, storage_key, created_at)
     values ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$11)`,
    [
      documentId,
      member.tenant_id,
      member.id,
      documentType,
      expiryDate,
      displayFileName(file.fileName),
      contentType,
      file.bytes.length,
      sha256,
      storageKey,
      iso(createdAt),
    ],
  );
  ctx.audit.targetType = 'document';
  ctx.audit.targetId = documentId;
  const rows = await query<DocumentRow>(`${DOCUMENT_SELECT} where d.id = $1`, [documentId]);
  return { status: 201, body: { document: documentJson(rows[0] as DocumentRow) } };
}

export async function getDocuments(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  const statusFilter = ctx.query.get('status');
  if (statusFilter !== null && statusFilter !== 'pending') {
    throw validationError({ status: 'The only filter is status=pending.' });
  }
  let rows: DocumentRow[];
  if (user.role === 'member') {
    const member = await requireMember(ctx);
    rows = await query<DocumentRow>(
      `${DOCUMENT_SELECT} where d.member_id = $1
         and ($2::text is null or d.status = $2::text)
       order by d.created_at desc`,
      [member.id, statusFilter],
    );
  } else {
    rows = await query<DocumentRow>(
      `${DOCUMENT_SELECT} where m.home_site_id = $1
         and ($2::text is null or d.status = $2::text)
       order by d.created_at desc`,
      [user.site_id, statusFilter],
    );
  }
  return {
    status: 200,
    body: {
      documents: rows.map((row) => ({ ...documentJson(row), business_name: row.business_name })),
    },
  };
}

async function documentInScope(ctx: RequestContext, documentId: string): Promise<DocumentRow> {
  const user = ctx.requireUser();
  if (!isUuid(documentId)) throw new ApiError('not_found');
  const rows = await query<DocumentRow>(`${DOCUMENT_SELECT} where d.id = $1`, [documentId]);
  const row = rows[0];
  if (row === undefined || row.tenant_id !== user.tenant_id) throw new ApiError('not_found');
  if (user.role === 'member') {
    const member = await requireMember(ctx);
    if (row.member_id !== member.id) throw new ApiError('not_found');
  }
  if (user.role === 'kitchen_manager' && row.home_site_id !== user.site_id) {
    throw new ApiError('not_found');
  }
  return row;
}

export async function getDocument(ctx: RequestContext): Promise<HandlerResult> {
  const row = await documentInScope(ctx, ctx.params.id as string);
  return { status: 200, body: { document: documentJson(row) } };
}

export async function getDocumentFile(ctx: RequestContext): Promise<HandlerResult> {
  const row = await documentInScope(ctx, ctx.params.id as string);
  let bytes: Buffer;
  try {
    bytes = await getObject(row.storage_key);
  } catch {
    throw new ApiError('storage_unavailable');
  }
  return {
    status: 200,
    raw: bytes,
    contentType: row.content_type,
    headers: {
      'Content-Length': String(row.size_bytes),
      ETag: `"${row.sha256}"`,
      'Content-Disposition': `attachment; filename="${row.file_name}"`,
      'Cache-Control': 'private, no-store',
    },
  };
}

export async function postVerify(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  const row = await documentInScope(ctx, ctx.params.id as string);
  ctx.audit.targetType = 'document';
  ctx.audit.targetId = row.id;
  const member = await memberById(row.member_id);
  if (member === null) throw new ApiError('not_found');
  const today = localDateOf(member.home_zone, nowMs());
  const updated = await tx(async (client) => {
    const current = await client.query<{ status: DocumentStatus }>(
      'select status from documents where id = $1 for update',
      [row.id],
    );
    const status = (current.rows[0] as { status: DocumentStatus }).status;
    if (status !== 'pending') throw new ApiError('invalid_transition');
    if (row.expiry_date < today) throw new ApiError('document_expired');
    await client.query(
      `update documents set status = 'verified', reviewed_by_user_id = $2, reviewed_at = $3
        where id = $1`,
      [row.id, user.user_id, iso(nowMs())],
    );
    const refreshed = await client.query<DocumentRow>(`${DOCUMENT_SELECT} where d.id = $1`, [row.id]);
    return refreshed.rows[0] as DocumentRow;
  });
  const validThrough = await validThroughFor(null, member);
  return {
    status: 200,
    body: {
      document: documentJson(updated),
      valid_through: validThrough[updated.doc_type],
    },
  };
}

export async function postReject(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  const body = ctx.json();
  const row = await documentInScope(ctx, ctx.params.id as string);
  ctx.audit.targetType = 'document';
  ctx.audit.targetId = row.id;
  const rawReason = body.reason;
  const unknown = Object.keys(body).filter((key) => key !== 'reason');
  if (unknown.length > 0) {
    const fields: Record<string, string> = {};
    for (const name of unknown) fields[name] = 'Unknown field.';
    throw validationError(fields);
  }
  const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
  if (reason.length < 3 || reason.length > 300) {
    throw validationError({ reason: 'Give a reason the member can act on.' });
  }
  const updated = await tx(async (client) => {
    const current = await client.query<{ status: DocumentStatus }>(
      'select status from documents where id = $1 for update',
      [row.id],
    );
    const status = (current.rows[0] as { status: DocumentStatus }).status;
    if (status !== 'pending') throw new ApiError('invalid_transition');
    await client.query(
      `update documents set status = 'rejected', rejection_reason = $2,
         reviewed_by_user_id = $3, reviewed_at = $4 where id = $1`,
      [row.id, reason, user.user_id, iso(nowMs())],
    );
    const refreshed = await client.query<DocumentRow>(`${DOCUMENT_SELECT} where d.id = $1`, [row.id]);
    return refreshed.rows[0] as DocumentRow;
  });
  return { status: 200, body: { document: documentJson(updated) } };
}
