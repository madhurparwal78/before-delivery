import { base64urlEncode } from '../../shared/scheme.js';
import { clockOffset, serverNow, setClockOffset } from '../clock.js';
import { pool } from '../db.js';
import { invalidField, sendJson, type RequestContext } from '../http.js';

function encodeValue(value: unknown): unknown {
  if (value instanceof Buffer) return base64urlEncode(new Uint8Array(value));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return Number(value);
  return value;
}

export async function getDump(ctx: RequestContext): Promise<void> {
  const tableRows = await pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  );
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const { table_name: name } of tableRows.rows) {
    const rows = await pool.query(`select * from "${name}"`);
    tables[name] = rows.rows.map((row) => {
      const encoded: Record<string, unknown> = {};
      for (const [column, value] of Object.entries(row as Record<string, unknown>)) {
        encoded[column] = encodeValue(value);
      }
      return encoded;
    });
  }
  sendJson(ctx.res, 200, { tables });
}

function clockBody(): { offset_ms: number; now: string } {
  return { offset_ms: clockOffset(), now: serverNow().toISOString() };
}

export async function getClock(ctx: RequestContext): Promise<void> {
  sendJson(ctx.res, 200, clockBody());
}

export async function postClock(ctx: RequestContext): Promise<void> {
  const offset = ctx.body['offset_ms'];
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    throw invalidField('offset_ms', 'invalid');
  }
  await setClockOffset(offset);
  sendJson(ctx.res, 200, clockBody());
}
