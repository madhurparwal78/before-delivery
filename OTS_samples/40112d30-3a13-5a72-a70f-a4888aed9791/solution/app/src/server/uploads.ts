import { randomUUID } from 'node:crypto';
import type { FileKind, FileAnswer } from '../shared/types.ts';
import { config } from './config.ts';
import { pool, transaction } from './db.ts';
import { fileTooLarge, fileType, notFound, uploadFailed } from './errors.ts';
import { sendJson, type Ctx } from './http.ts';
import { assertWritable, holdResponse } from './respondent.ts';
import { deleteObject, putObject } from './s3.ts';

// File answers: attached only after MinIO confirmed the object, stored byte for byte (brief: File answers).

const TYPES: Record<FileKind, { mime: string; name: string }> = {
  pdf: { mime: 'application/pdf', name: 'PDF' },
  png: { mime: 'image/png', name: 'PNG' },
  jpeg: { mime: 'image/jpeg', name: 'JPEG' },
};
const ORDER: FileKind[] = ['pdf', 'png', 'jpeg'];
const BYTES_PER_MB = 1_048_576;

const objectKey = (formId: string, responseId: string, question: string, fileId: string): string => `files/${formId}/${responseId}/${question}/${fileId}`;

function typeNames(accept: FileKind[]): string {
  const names = ORDER.filter((kind) => accept.includes(kind)).map((kind) => TYPES[kind].name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names.join('');
}

function fileName(ctx: Ctx): string {
  const header = ctx.req.headers['x-file-name'];
  let name = 'file';
  if (typeof header === 'string' && header) {
    try {
      name = decodeURIComponent(header);
    } catch {
      name = header;
    }
  }
  return name.replace(/[\u0000-\u001f"\\/]/g, '_').trim() || 'file';
}

export async function putFile(ctx: Ctx): Promise<void> {
  const key = ctx.params['key'] ?? '';
  const held = await holdResponse(pool, ctx, ctx.params['id'] ?? '');
  await assertWritable(pool, held);
  const question = held.def.pages.flatMap((p) => p.questions).find((q) => q.key === key && q.type === 'file');
  if (!question) throw notFound();
  const accept = question.accept ?? ORDER;
  const type = (ctx.req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const name = fileName(ctx);
  const label = question.label;
  if (!accept.some((kind) => TYPES[kind].mime === type)) throw fileType(label, typeNames(accept));
  const max = Math.min(question.max_bytes ?? config.uploadMaxBytes, config.uploadMaxBytes);
  if (ctx.raw.length > max) throw fileTooLarge(label, String(max / BYTES_PER_MB));
  const id = randomUUID();
  const location = objectKey(held.form.id, held.row.id, key, id);
  try {
    await putObject(location, ctx.raw, type);
  } catch {
    throw uploadFailed(name);
  }
  const answer: FileAnswer = { name, size: ctx.raw.length, type };
  const replaced = await transaction(async (tx) => {
    const old = await tx.query<{ object_key: string }>('DELETE FROM files WHERE response_id = $1 AND question_key = $2 RETURNING object_key', [held.row.id, key]);
    await tx.query('INSERT INTO files (id, response_id, form_id, question_key, name, size, type, object_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, held.row.id, held.form.id, key, name, answer.size, type, location]);
    await tx.query(`UPDATE responses SET answers = jsonb_set(answers, ARRAY[$2]::text[], $3::jsonb) WHERE id = $1`, [held.row.id, key, JSON.stringify(answer)]);
    return old.rows.map((row) => row.object_key);
  });
  await Promise.all(replaced.map((old) => deleteObject(old).catch(() => undefined)));
  sendJson(ctx, 201, answer);
}

export async function removeFile(ctx: Ctx): Promise<void> {
  const key = ctx.params['key'] ?? '';
  const held = await holdResponse(pool, ctx, ctx.params['id'] ?? '');
  await assertWritable(pool, held);
  const removed = await transaction(async (tx) => {
    const old = await tx.query<{ object_key: string }>('DELETE FROM files WHERE response_id = $1 AND question_key = $2 RETURNING object_key', [held.row.id, key]);
    await tx.query('UPDATE responses SET answers = answers - $2 WHERE id = $1', [held.row.id, key]);
    return old.rows.map((row) => row.object_key);
  });
  await Promise.all(removed.map((old) => deleteObject(old).catch(() => undefined)));
  ctx.res.writeHead(204, ctx.setCookies.length ? { 'Set-Cookie': ctx.setCookies } : {});
  ctx.res.end();
}

/** Files of answers discarded on submit are deleted for good. */
export async function discardFiles(responseId: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const { rows } = await pool.query<{ object_key: string }>(
    'DELETE FROM files WHERE response_id = $1 AND question_key = ANY($2) RETURNING object_key', [responseId, keys],
  );
  await Promise.all(rows.map((row) => deleteObject(row.object_key).catch(() => undefined)));
}
