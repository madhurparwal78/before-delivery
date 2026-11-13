import { clockOffset, now, setClockOffset } from './clock.js';
import { config } from './config.js';
import { pool, query } from './db.js';
import { invalid, open } from './http.js';
import { iso } from './records.js';
import { jsonBody } from './validate.js';

function plain(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return value.toString('base64url');
  if (value instanceof Date) return iso(value);
  return value;
}

/** Registered only when GRADING=1; otherwise these routes answer 404 like any unknown path. */
export function registerGradingRoutes(): void {
  if (!config.grading) return;

  open('GET', '/api/grading/dump', async () => {
    const tables = await query<{ table_name: string }>(
      pool,
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    const dump: Record<string, unknown[]> = {};
    for (const { table_name: table } of tables) {
      const rows = await query<Record<string, unknown>>(pool, `SELECT * FROM "${table}"`);
      dump[table] = rows.map((row) => Object.fromEntries(Object.entries(row).map(([column, value]) => [column, plain(value)])));
    }
    return { status: 200, body: { tables: dump } };
  });

  open('GET', '/api/grading/clock', async () => ({ status: 200, body: { offset_ms: clockOffset(), now: iso(now()) } }));

  open('POST', '/api/grading/clock', async ({ body }) => {
    const { offset_ms: offset } = jsonBody(body);
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw invalid({ offset_ms: 'invalid' });
    setClockOffset(offset);
    return { status: 200, body: { offset_ms: clockOffset(), now: iso(now()) } };
  });
}
