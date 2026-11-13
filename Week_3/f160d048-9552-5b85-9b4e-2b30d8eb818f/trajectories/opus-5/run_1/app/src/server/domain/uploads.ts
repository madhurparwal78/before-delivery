import { createHash } from 'node:crypto';
import { config } from '../config';
import { db, pool } from '../db/pool';
import { ApiError } from '../errors';

const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Judged by its bytes; the file name and declared type never count. */
export function assertPdf(bytes: Buffer): void {
  if (!bytes.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) throw new ApiError('resume_not_pdf');
  if (bytes.length > config.resumeMaxBytes) throw new ApiError('resume_too_large');
}

export function assertPng(bytes: Buffer): void {
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new ApiError('mark_not_png');
  if (bytes.length > config.markMaxBytes) throw new ApiError('mark_too_large');
}

export async function chargeUploadRate(userId: string, now: Date): Promise<void> {
  const since = new Date(now.getTime() - 60000);
  const row = await db.one<{ count: string }>(
    'SELECT count(*) AS count FROM upload_events WHERE user_id = $1 AND at > $2',
    [userId, since],
  );
  if (Number(row?.count ?? 0) >= config.uploadRatePerMinute) throw new ApiError('rate_limited');
  await db.query('INSERT INTO upload_events (user_id, at) VALUES ($1, $2)', [userId, now]);
}

export function requestFingerprint(parts: ReadonlyArray<string>, file: Buffer): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part).update('\u0000');
  hash.update(file);
  return hash.digest('hex');
}

/** Serialises simultaneous submits for one member and job. */
export async function withApplyLock<T>(userId: string, jobId: string, run: () => Promise<T>): Promise<T> {
  const key = BigInt(`0x${createHash('sha256').update(`${userId}:${jobId}`).digest('hex').slice(0, 15)}`).toString();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [key]);
    try {
      return await run();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [key]);
    }
  } finally {
    client.release();
  }
}

export function dateOnly(at: Date): string {
  return at.toISOString().slice(0, 10);
}
