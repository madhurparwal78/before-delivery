/** Health always answers 200; the body says whether Postgres and MinIO both answered within the budget. */
import { pool } from './db'
import { route } from './http'
import { storageAnswers } from './s3'

const BUDGET_MS = 1500

async function databaseAnswers(): Promise<boolean> {
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), BUDGET_MS))
  const query = pool.query('SELECT 1').then(() => true, () => false)
  return Promise.race([query, timeout])
}

route('GET', '/api/health', 'none', async () => {
  const [database, storage] = await Promise.all([databaseAnswers(), storageAnswers()])
  return { status: 200, body: { status: database && storage ? 'ok' : 'unavailable' } }
})
