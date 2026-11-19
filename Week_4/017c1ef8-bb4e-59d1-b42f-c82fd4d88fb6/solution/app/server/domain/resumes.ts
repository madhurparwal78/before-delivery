import { createHash } from 'node:crypto';
import { now } from '../clock.js';
import { config } from '../config.js';
import { maybeRow, type Db } from '../db.js';
import { notFound, unprocessable } from '../errors.js';
import { newId } from '../ids.js';
import { putConfirmed } from '../storage.js';

const PDF_MAGIC = Buffer.from('%PDF-');

interface ResumeUpload {
  resume_id: string;
  bytes: number;
  sha256: string;
}

/** Stores a PDF byte for byte and answers only after object storage confirmed its size. */
export async function storeResume(db: Db, memberId: string, file: Buffer): Promise<ResumeUpload> {
  if (!file.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) throw unprocessable('resume_type');
  if (file.length > config.resumeMaxBytes) throw unprocessable('resume_too_large', { limit: config.resumeMaxBytes });
  const id = newId();
  const key = `resumes/${memberId}/${id}.pdf`;
  await putConfirmed(key, file, 'application/pdf');
  const sha256 = createHash('sha256').update(file).digest('hex');
  await db.query('INSERT INTO resumes (id, member_id, object_key, bytes, sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [id, memberId, key, file.length, sha256, now()]);
  return { resume_id: id, bytes: file.length, sha256 };
}

/** A resume the member uploaded themselves: anyone else's id is not found. */
export async function requireOwnResume(db: Db, memberId: string, resumeId: string): Promise<void> {
  if (!(await maybeRow(db, 'SELECT 1 FROM resumes WHERE id = $1 AND member_id = $2', [resumeId, memberId]))) throw notFound();
}
