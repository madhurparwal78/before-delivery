import { query, type Queryable } from '../db/pool.ts';

export type Settings = {
  time_zone: string;
  operator_email: string;
  cursor_key: string;
};

export async function readSettings(client?: Queryable): Promise<Settings> {
  const runner = client ?? { query };
  const result = await runner.query<Settings>(
    `SELECT time_zone, operator_email, cursor_key FROM settings WHERE id = 1`,
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('Settings have not been seeded yet');
  return row;
}

export async function writeTimeZone(timeZone: string): Promise<Settings> {
  const result = await query<Settings>(
    `UPDATE settings SET time_zone = $1 WHERE id = 1
     RETURNING time_zone, operator_email, cursor_key`,
    [timeZone],
  );
  return result.rows[0] as Settings;
}
