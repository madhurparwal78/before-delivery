import { pool } from '../db';
import { isReady } from '../seed';
import type { HandlerResult } from '../http/context';

/** The one response outside the single error body: the health check writes its own. */
export async function getHealth(): Promise<HandlerResult> {
  if (!isReady()) return { status: 503, body: { status: 'starting' } };
  try {
    await pool.query('select 1');
  } catch {
    return { status: 503, body: { status: 'starting' } };
  }
  return { status: 200, body: { status: 'ok' } };
}
