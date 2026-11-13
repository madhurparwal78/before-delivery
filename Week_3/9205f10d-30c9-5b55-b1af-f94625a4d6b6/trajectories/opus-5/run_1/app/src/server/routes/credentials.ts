import { db, transact } from '../db.js';
import { ApiError, notFound, validationError } from '../http/errors.js';
import { json, type RouteContext, type RouteResult } from '../http/context.js';
import { route, type Route } from '../http/router.js';
import { agencyDateOf } from '../domain/agency-time.js';
import { credentialStatus } from '../domain/eligibility.js';
import {
  CONTENT_TYPE_BY_FILE_TYPE,
  boundaryOf,
  detectFileType,
  displayFileName,
  parseMultipart,
} from '../http/multipart.js';
import {
  assertCertificateReadable,
  credentialObjectKey,
  putCertificate,
  signedCertificateUrl,
  SIGNED_LINK_SECONDS,
} from '../services/storage.js';
import { newId } from '../ids.js';
import { readCredentialType, readExpiresOn, requireJsonContentType } from './validation.js';
import type { Credential, CredentialForReview, CredentialType } from '../../shared/types.js';

const CERTIFICATE_FILE_LIMIT = 5_000_000;

interface CredentialRow {
  id: string;
  interpreter_id: string;
  credential_type: CredentialType;
  verified: boolean;
  expires_on: string | null;
  uploaded_at: Date;
  file_name: string | null;
  storage_key: string | null;
}

interface ReviewRow extends CredentialRow {
  display_name: string;
  full_name: string;
}

const CREDENTIAL_COLUMNS = `c.id, c.interpreter_id, c.credential_type, c.verified,
  to_char(c.expires_on, 'YYYY-MM-DD') AS expires_on, c.uploaded_at, c.file_name, c.storage_key`;

function project(row: CredentialRow, today: string): Credential {
  return {
    id: row.id,
    credential_type: row.credential_type,
    status: credentialStatus(
      { credential_type: row.credential_type, verified: row.verified, expires_on: row.expires_on },
      today,
    ),
    expires_on: row.expires_on,
    uploaded_at: row.uploaded_at.toISOString(),
    file_name: row.file_name,
  };
}

async function myCredentialList(ctx: RouteContext): Promise<RouteResult> {
  const actor = ctx.gate('interpreter');
  const today = agencyDateOf(new Date());
  const result = await db.query<CredentialRow>(
    `SELECT ${CREDENTIAL_COLUMNS} FROM credentials c WHERE c.interpreter_id = $1
      ORDER BY c.uploaded_at DESC, c.id`,
    [actor.id],
  );
  return json({ credentials: result.rows.map((row) => project(row, today)) });
}

async function uploadCertificate(ctx: RouteContext): Promise<RouteResult> {
  const actor = ctx.gate('interpreter');
  const boundary = boundaryOf(ctx.contentType());
  if (!ctx.mediaType().startsWith('multipart/form-data') || boundary === null) {
    throw new ApiError('unsupported_type');
  }
  const parsed = parseMultipart(ctx.raw, boundary);
  const file = parsed?.files.find((entry) => entry.field === 'file') ?? null;
  const content = file === null || file.content.length === 0 ? null : file.content;

  if (content !== null && content.length > CERTIFICATE_FILE_LIMIT) {
    throw new ApiError('payload_too_large');
  }
  const fileType = content === null ? null : detectFileType(content);
  if (content !== null && fileType === null) throw new ApiError('unsupported_type');
  const credentialType = readCredentialType(parsed?.fields.get('credential_type'));
  if (content === null || fileType === null || file === null) {
    throw validationError({ file: 'Choose a certificate file.' });
  }

  const id = newId('cred');
  const key = credentialObjectKey(actor.id, id, fileType);
  await putCertificate(key, content, CONTENT_TYPE_BY_FILE_TYPE[fileType]);

  const today = agencyDateOf(new Date());
  const inserted = await transact(async (client) => {
    const result = await client.query<CredentialRow>(
      `INSERT INTO credentials (id, interpreter_id, credential_type, verified, file_name, storage_key)
       VALUES ($1, $2, $3, false, $4, $5)
       RETURNING id, interpreter_id, credential_type, verified,
         to_char(expires_on, 'YYYY-MM-DD') AS expires_on, uploaded_at, file_name, storage_key`,
      [id, actor.id, credentialType, displayFileName(file.file_name), key],
    );
    return result.rows[0] as CredentialRow;
  });
  return json(project(inserted, today), 201);
}

async function reviewList(ctx: RouteContext): Promise<RouteResult> {
  ctx.gate('coordinator');
  const today = agencyDateOf(new Date());
  const filter = ctx.queryParam('status') ?? 'uploaded';
  const result = await db.query<ReviewRow>(
    `SELECT ${CREDENTIAL_COLUMNS}, p.display_name, p.full_name
       FROM credentials c JOIN people p ON p.id = c.interpreter_id
      ORDER BY c.uploaded_at, c.id`,
  );
  const credentials: CredentialForReview[] = result.rows
    .map((row) => ({
      ...project(row, today),
      interpreter: { id: row.interpreter_id, display_name: row.display_name, full_name: row.full_name },
    }))
    .filter((credential) => filter === 'all' || credential.status === filter);
  return json({ credentials });
}

async function loadCredential(id: string): Promise<CredentialRow> {
  const result = await db.query<CredentialRow>(
    `SELECT ${CREDENTIAL_COLUMNS} FROM credentials c WHERE c.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (row === undefined) throw notFound();
  return row;
}

async function verifyCredential(ctx: RouteContext): Promise<RouteResult> {
  const row = await loadCredential(ctx.param('id'));
  ctx.gate('coordinator');
  if (row.verified) throw new ApiError('invalid_transition');
  requireJsonContentType(ctx.hasWrongContentType());
  const today = agencyDateOf(new Date());
  const expiresOn = readExpiresOn(ctx.body(), today);

  const updated = await transact(async (client) => {
    const result = await client.query<CredentialRow>(
      `UPDATE credentials SET verified = true, expires_on = $2 WHERE id = $1
       RETURNING id, interpreter_id, credential_type, verified,
         to_char(expires_on, 'YYYY-MM-DD') AS expires_on, uploaded_at, file_name, storage_key`,
      [row.id, expiresOn],
    );
    return result.rows[0] as CredentialRow;
  });
  return json(project(updated, today));
}

async function credentialFile(ctx: RouteContext): Promise<RouteResult> {
  const row = await loadCredential(ctx.param('id'));
  ctx.gate('coordinator');
  if (row.storage_key === null) throw notFound();
  await assertCertificateReadable(row.storage_key);
  return json({ url: signedCertificateUrl(row.storage_key), expires_in_seconds: SIGNED_LINK_SECONDS });
}

export const credentialRoutes: Route[] = [
  route('GET', '/api/me/credentials', myCredentialList),
  route('POST', '/api/me/credentials', uploadCertificate),
  route('GET', '/api/credentials', reviewList),
  route('POST', '/api/credentials/:id/verify', verifyCredential),
  route('GET', '/api/credentials/:id/file', credentialFile),
];
