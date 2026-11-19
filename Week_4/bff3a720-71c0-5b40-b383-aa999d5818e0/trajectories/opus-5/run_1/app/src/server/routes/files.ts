import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { now } from '../clock.js';
import { db, withTransaction } from '../db.js';
import { errors } from '../errors.js';
import { getObject, putObject, StorageDown } from '../storage.js';
import { publishToMembers } from '../live.js';
import { readFilePart, type Ctx, type Reply, type Router } from '../http.js';

type FileKind = 'photo' | 'id_document';

const SIGNATURES: Array<{ type: string; bytes: readonly number[] }> = [
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
];

/** The type is judged by the leading bytes, never by name or header. */
export function sniffType(bytes: Buffer): string | null {
  for (const signature of SIGNATURES) {
    if (signature.bytes.every((byte, index) => bytes[index] === byte)) return signature.type;
  }
  return null;
}

function objectKeyFor(kind: FileKind, memberId: string, fileId: string): string {
  return kind === 'photo'
    ? `photos/${memberId}/${fileId}`
    : `id-documents/${memberId}/${fileId}`;
}

async function storeUpload(
  ctx: Ctx,
  kind: FileKind,
): Promise<{ fileId: string; contentType: string }> {
  const member = ctx.requireMember();
  const part = readFilePart(ctx);
  if (!part) {
    throw errors.validationFailed({ file: 'Choose a file to upload.' });
  }
  const contentType = sniffType(part.bytes);
  const allowed =
    kind === 'photo'
      ? ['image/png', 'image/jpeg']
      : ['image/png', 'image/jpeg', 'application/pdf'];
  if (!contentType || !allowed.includes(contentType)) {
    throw kind === 'photo' ? errors.fileTypePhoto() : errors.fileTypeIdDocument();
  }
  const maxBytes = kind === 'photo' ? config.limits.photoMaxBytes : config.limits.idDocMaxBytes;
  if (part.bytes.byteLength > maxBytes) throw errors.fileTooLarge(maxBytes);

  const fileId = randomUUID();
  const objectKey = objectKeyFor(kind, member.id, fileId);
  try {
    await putObject(objectKey, part.bytes, contentType);
  } catch (error) {
    if (error instanceof StorageDown) throw errors.storageUnavailable();
    throw error;
  }
  await db.query(
    `insert into files (id, member_id, kind, object_key, content_type, size_bytes, created_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [fileId, member.id, kind, objectKey, contentType, part.bytes.byteLength, now()],
  );
  return { fileId, contentType };
}

async function uploadPhoto(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  const { fileId } = await storeUpload(ctx, 'photo');
  await db.query('update members set photo_file_id = $2 where id = $1', [member.id, fileId]);
  return { status: 201, body: { file_id: fileId, photo_url: `/api/files/${fileId}` } };
}

async function uploadIdDocument(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  const { fileId } = await storeUpload(ctx, 'id_document');
  const documentId = randomUUID();
  await withTransaction(async (tx) => {
    await tx.query(
      `update id_documents set state = 'superseded' where member_id = $1 and state = 'pending'`,
      [member.id],
    );
    await tx.query(
      `insert into id_documents (id, member_id, file_id, uploaded_at, state)
       values ($1, $2, $3, $4, 'pending')`,
      [documentId, member.id, fileId, now()],
    );
    await tx.query(`update members set id_state = 'pending' where id = $1`, [member.id]);
  });
  publishToMembers([member.id], 'id_review', { id_state: 'pending', reason: null });
  return {
    status: 201,
    body: { document_id: documentId, file_id: fileId, id_state: 'pending' },
  };
}

async function getIdDocument(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  const { rows } = await db.query<{ state: string; reason: string | null; file_id: string }>(
    `select state, reason, file_id from id_documents
      where member_id = $1 and state <> 'superseded' order by uploaded_at desc limit 1`,
    [member.id],
  );
  const latest = rows[0];
  const { rows: memberRows } = await db.query<{ id_state: string }>(
    'select id_state from members where id = $1',
    [member.id],
  );
  return {
    status: 200,
    body: {
      id_state: memberRows[0]?.id_state ?? 'none',
      reason: latest?.reason ?? null,
      file_id: latest?.file_id ?? null,
    },
  };
}

async function serveFile(ctx: Ctx): Promise<Reply> {
  const member = ctx.requireMember();
  const { rows } = await db.query<{
    member_id: string;
    kind: FileKind;
    object_key: string;
    content_type: string;
  }>('select member_id, kind, object_key, content_type from files where id = $1', [
    ctx.param('id'),
  ]);
  const file = rows[0];
  if (!file) throw errors.notFound();
  if (file.kind === 'id_document') {
    const maySee = file.member_id === member.id || member.roles.includes('founder');
    if (!maySee) throw errors.notFound();
  }
  try {
    const object = await getObject(file.object_key);
    return { status: 200, raw: object.body, contentType: file.content_type };
  } catch (error) {
    if (error instanceof StorageDown) throw errors.storageUnavailable();
    throw error;
  }
}

export function registerFileRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/me/photo',
    kind: 'upload',
    auth: 'member',
    handler: uploadPhoto,
  });
  router.add({
    method: 'POST',
    pattern: '/api/me/id-document',
    kind: 'upload',
    auth: 'member',
    handler: uploadIdDocument,
  });
  router.add({
    method: 'GET',
    pattern: '/api/me/id-document',
    kind: 'plain',
    auth: 'member',
    handler: getIdDocument,
  });
  router.add({
    method: 'GET',
    pattern: '/api/files/:id',
    kind: 'plain',
    auth: 'member',
    handler: serveFile,
  });
}
