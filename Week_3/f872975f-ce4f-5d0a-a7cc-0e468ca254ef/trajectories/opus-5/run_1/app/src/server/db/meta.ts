import { query } from './pool';

let cached: string | null = null;

/** The yard's own id, generated once per database and shared by every instance. */
export async function yardId(): Promise<string> {
  if (cached !== null) return cached;
  const found = await query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'yard_id'`);
  const value = found[0]?.value;
  if (value === undefined) throw new Error('the yard id is missing from the database');
  cached = value;
  return value;
}
