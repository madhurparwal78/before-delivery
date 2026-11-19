import { pool } from './db';
import { storageAnswers } from './s3';

async function databaseAnswers(): Promise<boolean> {
  try {
    await Promise.race([pool.query('SELECT 1'), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))]);
    return true;
  } catch {
    return false;
  }
}

/** Always answers 200: `ok` when Postgres and MinIO both answer, `unavailable` otherwise. */
export async function health(): Promise<{ status: 'ok' | 'unavailable' }> {
  const [database, storage] = await Promise.all([databaseAnswers(), storageAnswers()]);
  return { status: database && storage ? 'ok' : 'unavailable' };
}
